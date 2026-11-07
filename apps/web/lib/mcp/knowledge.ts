import "server-only";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { loadGraph } from "@/lib/graph/load";
import type { GraphPayload } from "@/lib/graph/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type KnownRepository = { id: string; full_name: string; source: string };

/**
 * The server client bypasses Row Level Security, so this list is the whole access check:
 * every tool starts here, and a key only ever reaches what its owner saved.
 */
export async function repositoriesOf(userId: string): Promise<KnownRepository[]> {
  const { data, error } = await createAdminClient()
    .from("saved_repositories")
    .select("repositories (id, full_name, source)")
    .eq("user_id", userId)
    .overrideTypes<{ repositories: KnownRepository }[], { merge: false }>();

  if (error) throw new Error(`Could not list repositories: ${error.code}`);
  return data.map((row) => row.repositories);
}

export function chooseRepository(repositories: KnownRepository[], name: string) {
  const wanted = name.trim().toLowerCase();
  const exact = repositories.filter((r) => r.full_name.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]!;

  const byName = repositories.filter((r) => r.full_name.toLowerCase().endsWith(`/${wanted}`));
  return byName.length === 1 ? byName[0]! : null;
}

export async function loadKnowledge(repositoryId: string): Promise<GraphPayload | null> {
  const db = createAdminClient();
  const { data: run, error } = await db
    .from("analysis_runs")
    .select("id, stats")
    .eq("repository_id", repositoryId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load analysis: ${error.code}`);
  if (!run) return null;

  const stats = run.stats as Partial<AnalysisStats>;
  return {
    ...(await loadGraph(run.id, db)),
    cycles: stats.cycles ?? [],
    otherFiles: stats.otherFiles ?? null,
    otherFileCount: stats.otherFileCount ?? 0,
  };
}
