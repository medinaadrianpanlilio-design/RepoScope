import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportRule } from "@reposcope/engine";
import { createClient } from "@/lib/supabase/server";
import { loadGraph } from "./load";
import { analysisRisks, type RiskSide, type RiskWarning } from "./risks";

export type RiskReport = {
  /** False on a first analysis, when there's nothing earlier to compare with. */
  compared: boolean;
  warnings: RiskWarning[];
};

type RunRow = { id: string; stats: { cycles?: string[][] } | null };

async function side(run: RunRow, client: SupabaseClient): Promise<RiskSide> {
  const { files, edges } = await loadGraph(run.id, client);
  return { files, edges, cycles: run.stats?.cycles ?? [] };
}

/** Compares the two newest analyses. Reads as the visitor unless given a server client. */
export async function riskReport(
  repositoryId: string,
  rules: ImportRule[],
  client?: SupabaseClient,
): Promise<RiskReport | null> {
  const db = client ?? (await createClient());
  const { data, error } = await db
    .from("analysis_runs")
    .select("id, stats")
    .eq("repository_id", repositoryId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(2)
    .overrideTypes<RunRow[], { merge: false }>();

  if (error) throw new Error(`Could not load analyses: ${error.code}`);
  const [latest, earlier] = data;
  if (!latest) return null;

  const [current, previous] = await Promise.all([
    side(latest, db),
    earlier ? side(earlier, db) : null,
  ]);
  return { compared: previous !== null, warnings: analysisRisks({ current, previous, rules }) };
}
