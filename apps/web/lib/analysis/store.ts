import "server-only";
import type { AnalysisResult } from "@reposcope/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { RunRecord } from "./claim";
import type { AnalysisStats, RunStatus } from "./pipeline";

const CHUNK_SIZE = 500;
const RUN_COLUMNS =
  "id, status, error_message, created_at, started_at, analysis_version:stats->>version";

export function runStore(repositoryId: string, commitSha: string) {
  const db = createAdminClient();

  return {
    async insert(): Promise<RunRecord | null> {
      const { data, error } = await db
        .from("analysis_runs")
        .upsert(
          { repository_id: repositoryId, commit_sha: commitSha },
          { onConflict: "repository_id,commit_sha", ignoreDuplicates: true },
        )
        .select(RUN_COLUMNS);
      if (error) throw new Error(`Could not create run: ${error.code}`);
      return data[0] ?? null;
    },

    async find(): Promise<RunRecord> {
      const { data, error } = await db
        .from("analysis_runs")
        .select(RUN_COLUMNS)
        .eq("repository_id", repositoryId)
        .eq("commit_sha", commitSha)
        .single();
      if (error) throw new Error(`Could not load run: ${error.code}`);
      return data;
    },

    async restart(run: RunRecord): Promise<boolean> {
      let update = db
        .from("analysis_runs")
        .update({
          status: "queued",
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
          stats: null,
        })
        .eq("id", run.id)
        .eq("status", run.status);
      update = run.started_at ? update.eq("started_at", run.started_at) : update.is("started_at", null);

      const { data, error } = await update.select("id");
      if (error) throw new Error(`Could not restart run: ${error.code}`);
      return data.length > 0;
    },
  };
}

export function runWriter(runId: string) {
  const db = createAdminClient();

  async function updateRun(fields: Record<string, unknown>) {
    const { error } = await db.from("analysis_runs").update(fields).eq("id", runId);
    if (error) throw new Error(`Could not update run: ${error.code}`);
  }

  async function insertAll(table: string, rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK_SIZE));
      if (error) throw new Error(`Could not save ${table}: ${error.code}`);
    }
  }

  async function clearResults() {
    const { error } = await db.from("repository_files").delete().eq("analysis_id", runId);
    if (error) throw new Error(`Could not clear results: ${error.code}`);
  }

  return {
    async setStatus(status: RunStatus) {
      await updateRun({
        status,
        ...(status === "fetching" ? { started_at: new Date().toISOString() } : {}),
      });
    },

    async save(result: AnalysisResult) {
      await clearResults(); // A retried run may have left partial rows behind.

      const fileIds = new Map<string, number>();
      for (let i = 0; i < result.files.length; i += CHUNK_SIZE) {
        const { data, error } = await db
          .from("repository_files")
          .insert(
            result.files.slice(i, i + CHUNK_SIZE).map((file) => ({
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
          )
          .select("id, file_path");
        if (error) throw new Error(`Could not save files: ${error.code}`);
        for (const row of data) fileIds.set(row.file_path, row.id);
      }

      await insertAll(
        "dependency_edges",
        result.edges.map((edge) => ({
          analysis_id: runId,
          source_file_id: fileIds.get(edge.source),
          target_file_id: fileIds.get(edge.target),
          relationship_type: edge.type,
          import_specifier: edge.specifier,
          line_number: edge.line,
        })),
      );

      await insertAll(
        "unresolved_imports",
        result.unresolved.map((item) => ({
          analysis_id: runId,
          source_file_id: fileIds.get(item.source),
          import_specifier: item.specifier,
          line_number: item.line,
        })),
      );
    },

    async complete(stats: AnalysisStats) {
      await updateRun({ status: "completed", stats, completed_at: new Date().toISOString() });
    },

    async fail(message: string) {
      await updateRun({ status: "failed", error_message: message });
      await clearResults().catch(() => undefined);
    },
  };
}

/** Reads as the visitor, so Row Level Security decides what they can see. */
export async function getRun(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select(`${RUN_COLUMNS}, repository_id, commit_sha, completed_at, stats`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load run: ${error.code}`);
  return data;
}

export async function getLatestRun(repositoryId: string): Promise<RunRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select(RUN_COLUMNS)
    .eq("repository_id", repositoryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load run: ${error.code}`);
  return data;
}

export async function getLatestCompletedRun(repositoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, commit_sha, base_commit_sha, is_working_copy, completed_at, stats")
    .eq("repository_id", repositoryId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load results: ${error.code}`);
  return data;
}

/** Reads as the visitor. A file only matches inside its own analysis. */
export async function getFile(analysisId: string, fileId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repository_files")
    .select("file_path, language, line_count, exported_names")
    .eq("analysis_id", analysisId)
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load file: ${error.code}`);
  return data;
}
