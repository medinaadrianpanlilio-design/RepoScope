import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { foundPaths, readFoundConventions } from "@/lib/conventions/found";
import { allowRequest } from "@/lib/rate-limit";
import { getRepository } from "@/lib/repositories/queries";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/repositories/[id]/found-conventions">,
) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  try {
    const repository = await getRepository(id);
    if (!repository) return notFound();

    const run = await getLatestCompletedRun(id);
    if (!run) return apiData([]);

    if (!(await allowRequest("source", request.headers))) {
      return apiError("too_many_requests", "Too many files opened. Try again soon.", 429);
    }

    const stats = run.stats as AnalysisStats;
    const paths = foundPaths(stats.otherFiles ?? null, stats.otherFileCount ?? 0);

    return apiData(
      await readFoundConventions({ ...repository, commitSha: run.commit_sha }, paths),
    );
  } catch (error) {
    console.error("Found conventions failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("found_failed", "We couldn't read those files.", 500);
  }
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
