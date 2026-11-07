import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { planCleanup, type CleanupRun } from "./plan";

const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof createAdminClient>;

async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not read data: ${error.code}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

async function inBatches(ids: string[], action: (batch: string[]) => PromiseLike<{ error: { code: string } | null }>) {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const { error } = await action(ids.slice(i, i + BATCH_SIZE));
    if (error) throw new Error(`Could not clean up: ${error.code}`);
  }
}

function readInput(db: Db) {
  return Promise.all([
    readAll<{ id: string; updated_at: string }>((from, to) =>
      db.from("repositories").select("id, updated_at").order("id").range(from, to),
    ),
    readAll<{ repository_id: string }>((from, to) =>
      db.from("saved_repositories").select("repository_id").order("repository_id").range(from, to),
    ),
    readAll<CleanupRun>((from, to) =>
      db
        .from("analysis_runs")
        .select("id, repository_id, status, error_message, created_at, started_at, completed_at")
        .order("id")
        .range(from, to),
    ),
  ]);
}

/**
 * The once-a-day job. Reading the tables also counts as database activity, which keeps a
 * free Supabase project from pausing. Trimmed runs keep their stats for history.
 */
export async function runDailyMaintenance(now = new Date()) {
  const db = createAdminClient();
  const [repositories, saved, runs] = await readInput(db);

  const plan = planCleanup(
    { repositories, savedRepositoryIds: new Set(saved.map((s) => s.repository_id)), runs },
    now,
  );

  await inBatches(plan.failRunIds, (batch) =>
    db
      .from("analysis_runs")
      .update({ status: "failed", error_message: "The analysis ran past the time limit. Try again." })
      .in("id", batch),
  );
  await inBatches([...plan.failRunIds, ...plan.trimRunIds], (batch) =>
    db.from("repository_files").delete().in("analysis_id", batch),
  );
  await inBatches(plan.deleteRepositoryIds, (batch) =>
    db.from("repositories").delete().in("id", batch),
  );

  const { error, count } = await db
    .from("rate_limits")
    .delete({ count: "exact" })
    .lt("window_start", new Date(now.getTime() - RATE_LIMIT_RETENTION_MS).toISOString());
  if (error) throw new Error(`Could not clear rate limits: ${error.code}`);

  return {
    repositoriesDeleted: plan.deleteRepositoryIds.length,
    analysesTrimmed: plan.trimRunIds.length,
    stuckRunsClosed: plan.failRunIds.length,
    rateLimitRowsCleared: count ?? 0,
  };
}
