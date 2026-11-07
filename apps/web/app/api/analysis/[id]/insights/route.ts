import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getRun } from "@/lib/analysis/store";
import { generateInsights } from "@/lib/graph/insights";
import { loadGraph } from "@/lib/graph/load";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/analysis/[id]/insights">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const run = await getRun(id);
  if (!run) return notFound();
  if (run.status !== "completed") {
    return apiError("not_ready", "This analysis hasn't finished.", 409);
  }

  const stats = run.stats as AnalysisStats;
  const { files, edges, unresolved } = await loadGraph(id);

  return apiData(
    generateInsights({ files, edges, unresolved, cycles: stats.cycles, cycleCount: stats.cycleCount }),
  );
}

function notFound() {
  return apiError("not_found", "Analysis not found.", 404);
}
