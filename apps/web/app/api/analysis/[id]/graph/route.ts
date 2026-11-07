import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getRun } from "@/lib/analysis/store";
import { loadGraph } from "@/lib/graph/load";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/analysis/[id]/graph">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const run = await getRun(id);
  if (!run) return notFound();
  if (run.status !== "completed") {
    return apiError("not_ready", "This analysis hasn't finished.", 409);
  }

  return apiData(await loadGraph(id));
}

function notFound() {
  return apiError("not_found", "Analysis not found.", 404);
}
