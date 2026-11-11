import "server-only";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { createClient } from "@/lib/supabase/server";
import { EXAMPLES, fullNameOf } from "./list";

export type ReadyExample = {
  repositoryId: string;
  fullName: string;
  about: string;
  sourceFiles: number;
  dependencies: number;
};

/**
 * The examples that finished an analysis, with numbers from that analysis. One that isn't ready
 * is left out rather than shown empty. Reads as the visitor, since examples are public.
 */
export async function readyExamples(): Promise<ReadyExample[]> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("repositories")
    .select("id, full_name")
    .is("owner_user_id", null)
    .in("full_name", EXAMPLES.map(fullNameOf));
  if (error) throw new Error(`Could not list examples: ${error.code}`);
  if (rows.length === 0) return [];

  const { data: runs, error: runsError } = await supabase
    .from("analysis_runs")
    .select("repository_id, stats, completed_at")
    .in(
      "repository_id",
      rows.map((row) => row.id),
    )
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (runsError) throw new Error(`Could not read examples: ${runsError.code}`);

  return EXAMPLES.flatMap((example) => {
    const row = rows.find((r) => r.full_name.toLowerCase() === fullNameOf(example).toLowerCase());
    const run = row && runs.find((r) => r.repository_id === row.id);
    if (!row || !run) return [];
    const { totals } = run.stats as AnalysisStats;
    return [
      {
        repositoryId: row.id,
        fullName: row.full_name,
        about: example.about,
        sourceFiles: totals.sourceFiles,
        dependencies: totals.internalDependencies,
      },
    ];
  });
}
