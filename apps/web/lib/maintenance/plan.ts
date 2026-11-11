import { createHash, timingSafeEqual } from "node:crypto";
import { isStale, type RunRecord } from "@/lib/analysis/claim";
import { isExampleRow } from "@/lib/examples/list";

export type CleanupRun = RunRecord & {
  repository_id: string;
  completed_at: string | null;
};

type CleanupInput = {
  repositories: { id: string; updated_at: string; full_name: string; owner_user_id: string | null }[];
  savedRepositoryIds: Set<string>;
  runs: CleanupRun[];
};

const FULL_ANALYSES_KEPT = 5;
const UNSAVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Decides what to clean up without touching anything, so the rules can be tested. Example
 * repositories are kept like saved ones, so anyone can always open them.
 */
export function planCleanup({ repositories, savedRepositoryIds, runs }: CleanupInput, now: Date) {
  const cutoff = now.getTime() - UNSAVED_RETENTION_MS;
  const lastAnalysis = new Map<string, number>();
  for (const run of runs) {
    const created = new Date(run.created_at).getTime();
    lastAnalysis.set(run.repository_id, Math.max(lastAnalysis.get(run.repository_id) ?? 0, created));
  }

  const deleteRepositoryIds = repositories
    .filter((repository) => {
      const { id, updated_at } = repository;
      const lastUsed = Math.max(new Date(updated_at).getTime(), lastAnalysis.get(id) ?? 0);
      return !savedRepositoryIds.has(id) && !isExampleRow(repository) && lastUsed < cutoff;
    })
    .map(({ id }) => id);

  const deleted = new Set(deleteRepositoryIds);
  const kept = runs.filter((run) => !deleted.has(run.repository_id));

  const completedByRepository = new Map<string, CleanupRun[]>();
  for (const run of kept) {
    if (run.status !== "completed") continue;
    const group = completedByRepository.get(run.repository_id) ?? [];
    group.push(run);
    completedByRepository.set(run.repository_id, group);
  }

  const trimRunIds = [...completedByRepository.values()].flatMap((group) =>
    group
      .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
      .slice(FULL_ANALYSES_KEPT)
      .map((run) => run.id),
  );

  return {
    deleteRepositoryIds,
    trimRunIds,
    failRunIds: kept.filter((run) => isStale(run, now)).map((run) => run.id),
  };
}

/** Compares hashes so the check takes the same time however close a guess is. */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
