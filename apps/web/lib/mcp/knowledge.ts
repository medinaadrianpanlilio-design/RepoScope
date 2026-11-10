import "server-only";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { loadGraph } from "@/lib/graph/load";
import type { GraphPayload } from "@/lib/graph/types";
import { privateAccessProblem, reachableBy, type InstallationState } from "@/lib/mcp/answers";
import { createAdminClient } from "@/lib/supabase/admin";

type StoredRepository = {
  id: string;
  full_name: string;
  source: string;
  owner: string;
  name: string;
  owner_user_id: string | null;
  github_id: number | null;
  installation_id: string | null;
};

export type KnownRepository = StoredRepository & {
  /** Why its knowledge can't be read right now, or null when it can. */
  unavailable: string | null;
};

export type Knowledge = GraphPayload & {
  run: {
    commitSha: string | null;
    isWorkingCopy: boolean;
    completedAt: string | null;
    stats: AnalysisStats;
  };
};

/**
 * The server client bypasses Row Level Security, so this list is the whole access check:
 * every tool starts here, and a key only ever reaches what its owner saved. A private
 * repository also needs its Installation to be live, as revoking it on GitHub ends access here.
 */
export async function repositoriesOf(userId: string): Promise<KnownRepository[]> {
  const db = createAdminClient();
  const [saved, installations] = await Promise.all([
    db
      .from("saved_repositories")
      .select("repositories (id, full_name, source, owner, name, owner_user_id, github_id, installation_id)")
      .eq("user_id", userId)
      .overrideTypes<{ repositories: StoredRepository }[], { merge: false }>(),
    db
      .from("github_installations")
      .select("id, revoked_at, suspended_at, verified_repository_ids")
      .eq("user_id", userId)
      .overrideTypes<InstallationState[], { merge: false }>(),
  ]);

  if (saved.error) throw new Error(`Could not list repositories: ${saved.error.code}`);
  if (installations.error) throw new Error(`Could not list installations: ${installations.error.code}`);

  return reachableBy(
    saved.data.map((row) => row.repositories),
    userId,
  ).map((repository) => ({
    ...repository,
    unavailable: privateAccessProblem(repository, installations.data),
  }));
}

export async function loadKnowledge(repositoryId: string): Promise<Knowledge | null> {
  const db = createAdminClient();
  const { data: run, error } = await db
    .from("analysis_runs")
    .select("id, stats, commit_sha, is_working_copy, completed_at")
    .eq("repository_id", repositoryId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load analysis: ${error.code}`);
  if (!run) return null;

  const stats = run.stats as AnalysisStats;
  return {
    ...(await loadGraph(run.id, db)),
    cycles: stats.cycles ?? [],
    otherFiles: stats.otherFiles ?? null,
    otherFileCount: stats.otherFileCount ?? 0,
    run: {
      commitSha: run.commit_sha,
      isWorkingCopy: run.is_working_copy,
      completedAt: run.completed_at,
      stats,
    },
  };
}
