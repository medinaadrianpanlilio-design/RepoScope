import "server-only";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { loadGraph } from "@/lib/graph/load";
import type { GraphPayload } from "@/lib/graph/types";
import { reachableBy } from "@/lib/mcp/answers";
import { createAdminClient } from "@/lib/supabase/admin";

export type KnownRepository = {
  id: string;
  full_name: string;
  source: string;
  owner: string;
  name: string;
  owner_user_id: string | null;
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
 * every tool starts here, and a key only ever reaches what its owner saved.
 */
export async function repositoriesOf(userId: string): Promise<KnownRepository[]> {
  const { data, error } = await createAdminClient()
    .from("saved_repositories")
    .select("repositories (id, full_name, source, owner, name, owner_user_id)")
    .eq("user_id", userId)
    .overrideTypes<{ repositories: KnownRepository }[], { merge: false }>();

  if (error) throw new Error(`Could not list repositories: ${error.code}`);
  return reachableBy(
    data.map((row) => row.repositories),
    userId,
  );
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
