import "server-only";
import { ANALYSIS_VERSION } from "@/lib/analysis/claim";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SyncChunk, SyncStart } from "./schema";

const INSERT_SIZE = 500;
const PAGE_SIZE = 1000;

type Db = ReturnType<typeof createAdminClient>;

async function findOrCreateRepository(db: Db, userId: string, start: SyncStart): Promise<string> {
  const fullName = start.remote ?? `local/${start.name}`;
  const [owner, name] = fullName.split("/") as [string, string];

  const { data: existing, error } = await db
    .from("repositories")
    .select("id")
    .eq("owner_user_id", userId)
    .ilike("full_name", fullName.replace(/[%_]/g, "\\$&"))
    .maybeSingle();
  if (error) throw new Error(`Could not find folder: ${error.code}`);

  const fields = { default_branch: start.branch ?? "local", updated_at: new Date().toISOString() };
  let repositoryId = existing?.id;

  if (repositoryId) {
    await db.from("repositories").update(fields).eq("id", repositoryId);
  } else {
    const { data, error: insertError } = await db
      .from("repositories")
      .insert({
        ...fields,
        source: "local",
        owner_user_id: userId,
        is_private: true,
        owner,
        name,
        full_name: fullName,
        remote_full_name: start.remote,
        github_url: start.remote ? `https://github.com/${start.remote}` : "",
      })
      .select("id")
      .single();
    if (insertError) throw new Error(`Could not create folder: ${insertError.code}`);
    repositoryId = data.id as string;
  }

  // Syncing a folder puts it back on the dashboard if its owner removed it.
  const { error: saveError } = await db
    .from("saved_repositories")
    .upsert(
      { user_id: userId, repository_id: repositoryId },
      { onConflict: "user_id,repository_id", ignoreDuplicates: true },
    );
  if (saveError) throw new Error(`Could not save folder: ${saveError.code}`);
  return repositoryId;
}

/** Decides whether anything needs uploading, and opens a run if it does. */
export async function startSync(userId: string, start: SyncStart) {
  const db = createAdminClient();
  const repositoryId = await findOrCreateRepository(db, userId, start);
  const dirty = start.dirty || start.commit === null;

  // A clean folder replaces any uncommitted analysis, and so does a new one.
  await db.from("analysis_runs").delete().eq("repository_id", repositoryId).eq("is_working_copy", true);

  if (!dirty) {
    // Only the newest analysis is what people see, so an older match isn't up to date:
    // switching back to a branch has to bring its results to the front.
    const { data: latest } = await db
      .from("analysis_runs")
      .select("commit_sha, stats->>version")
      .eq("repository_id", repositoryId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.commit_sha === start.commit && latest?.version === ANALYSIS_VERSION) {
      return { repositoryId, upToDate: true as const };
    }
    await db
      .from("analysis_runs")
      .delete()
      .eq("repository_id", repositoryId)
      .eq("commit_sha", start.commit as string);
  }

  const { data, error } = await db
    .from("analysis_runs")
    .insert({
      repository_id: repositoryId,
      status: "saving",
      started_at: new Date().toISOString(),
      is_working_copy: dirty,
      commit_sha: dirty ? null : start.commit,
      base_commit_sha: dirty ? start.commit : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not start sync: ${error.code}`);

  return { repositoryId, upToDate: false as const, runId: data.id };
}

/** A key may only touch an unfinished run in a folder its owner owns. */
export async function ownsOpenRun(userId: string, runId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("analysis_runs")
    .select("status, repositories!inner(owner_user_id)")
    .eq("id", runId)
    .eq("repositories.owner_user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not check run: ${error.code}`);
  return data?.status === "saving";
}

async function fileIds(db: Db, runId: string): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("repository_files")
      .select("id, file_path")
      .eq("analysis_id", runId)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not read files: ${error.code}`);
    for (const row of data) ids.set(row.file_path, row.id);
    if (data.length < PAGE_SIZE) return ids;
  }
}

async function insertRows(db: Db, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += INSERT_SIZE) {
    const { error } = await db.from(table).insert(rows.slice(i, i + INSERT_SIZE));
    if (error) throw new Error(`Could not save ${table}: ${error.code}`);
  }
}

async function countRows(db: Db, table: string, runId: string): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("analysis_id", runId);
  if (error) throw new Error(`Could not count ${table}: ${error.code}`);
  return count ?? 0;
}

export type ChunkResult = { ok: true; completed?: boolean } | { ok: false; message: string };

export async function saveChunk(runId: string, chunk: SyncChunk): Promise<ChunkResult> {
  const db = createAdminClient();

  if (chunk.kind === "files") {
    await insertRows(
      db,
      "repository_files",
      chunk.rows.map((file) => ({
        analysis_id: runId,
        file_path: file.path,
        language: file.language,
        file_size: file.size,
        line_count: file.lines,
        incoming_count: file.incoming,
        outgoing_count: file.outgoing,
        exported_names: file.exports,
        has_syntax_errors: file.hasSyntaxErrors,
      })),
    );
    return { ok: true };
  }

  if (chunk.kind === "complete") {
    // Only a full upload may be shown. Anything missing leaves the run unfinished.
    const [files, edges, unresolved] = await Promise.all([
      countRows(db, "repository_files", runId),
      countRows(db, "dependency_edges", runId),
      countRows(db, "unresolved_imports", runId),
    ]);
    if (files !== chunk.files || edges !== chunk.edges || unresolved !== chunk.unresolved) {
      return { ok: false, message: "The upload was incomplete." };
    }

    const { error } = await db
      .from("analysis_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        stats: { ...chunk.stats, version: ANALYSIS_VERSION },
      })
      .eq("id", runId);
    if (error) throw new Error(`Could not finish sync: ${error.code}`);
    return { ok: true, completed: true };
  }

  const ids = await fileIds(db, runId);
  const idOf = (path: string) => ids.get(path);

  if (chunk.kind === "edges") {
    if (chunk.rows.some((row) => !idOf(row.source) || !idOf(row.target))) {
      return { ok: false, message: "An edge points at an unknown file." };
    }
    await insertRows(
      db,
      "dependency_edges",
      chunk.rows.map((row) => ({
        analysis_id: runId,
        source_file_id: idOf(row.source),
        target_file_id: idOf(row.target),
        relationship_type: row.type,
        import_specifier: row.specifier,
        line_number: row.line,
      })),
    );
    return { ok: true };
  }

  if (chunk.rows.some((row) => !idOf(row.source))) {
    return { ok: false, message: "An import points at an unknown file." };
  }
  await insertRows(
    db,
    "unresolved_imports",
    chunk.rows.map((row) => ({
      analysis_id: runId,
      source_file_id: idOf(row.source),
      import_specifier: row.specifier,
      line_number: row.line,
    })),
  );
  return { ok: true };
}
