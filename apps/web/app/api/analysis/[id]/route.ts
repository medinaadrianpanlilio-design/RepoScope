import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { displayStatus } from "@/lib/analysis/claim";
import { getRun } from "@/lib/analysis/store";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/analysis/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const run = await getRun(id);
  if (!run) return notFound();

  return apiData({
    id: run.id,
    repositoryId: run.repository_id,
    commitSha: run.commit_sha,
    ...displayStatus(run, new Date()),
    startedAt: run.started_at,
    completedAt: run.completed_at,
    stats: run.stats,
  });
}

function notFound() {
  return apiError("not_found", "Analysis not found.", 404);
}
