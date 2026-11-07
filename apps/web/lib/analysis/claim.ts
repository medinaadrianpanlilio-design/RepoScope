export type RunRecord = {
  id: string;
  status: string;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  analysis_version?: string | null;
};

export type ClaimDeps = {
  /** Creates the run, or returns null when this commit already has one. */
  insert: () => Promise<RunRecord | null>;
  find: () => Promise<RunRecord>;
  /** Resets the run only if nobody changed it first. Returns whether this caller won. */
  restart: (run: RunRecord) => Promise<boolean>;
};

/** Raise this when results gain new data, so older analyses can be refreshed. */
export const ANALYSIS_VERSION = "2";

/** Vercel stops a function at 300 seconds, so a run still going after this was killed. */
const STALE_AFTER_MS = 6 * 60 * 1000;

const FINISHED = new Set(["completed", "failed"]);

export function isStale(run: RunRecord, now: Date): boolean {
  if (FINISHED.has(run.status)) return false;
  const since = new Date(run.started_at ?? run.created_at).getTime();
  return now.getTime() - since > STALE_AFTER_MS;
}

export function displayStatus(run: RunRecord, now: Date) {
  return isStale(run, now)
    ? { status: "failed", errorMessage: "The analysis ran past the time limit. Try again." }
    : { status: run.status, errorMessage: run.error_message };
}

/**
 * Decides who runs a commit's analysis. The database's unique constraint settles a race
 * between two first requests, and restart's condition settles a race between two retries.
 */
export async function claimRun(deps: ClaimDeps, now = new Date()) {
  const created = await deps.insert();
  if (created) return { run: created, start: true };

  const run = await deps.find();
  const outdated = run.status === "completed" && run.analysis_version !== ANALYSIS_VERSION;
  if (run.status !== "failed" && !isStale(run, now) && !outdated) return { run, start: false };

  return { run, start: await deps.restart(run) };
}
