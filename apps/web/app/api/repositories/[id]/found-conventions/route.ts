import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { getOptionalUser } from "@/lib/auth";
import { foundPaths, MAX_FOUND_BYTES, readFoundConventions } from "@/lib/conventions/found";
import { describeAccess, openRepository } from "@/lib/github/repository-access";
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

    const target = { ...repository, commitSha: run.commit_sha };
    if (repository.source === "local" || !run.commit_sha) {
      return apiData(await readFoundConventions(target, paths));
    }

    const user = await getOptionalUser();
    const access = await openRepository(repository, user?.id ?? null);
    if (!access.ok) {
      const failure = describeAccess(access.error);
      return apiError(failure.code, failure.message, failure.status);
    }

    const sha = run.commit_sha;
    return apiData(
      await readFoundConventions(target, paths, (path) =>
        access.reader.file(sha, path, { maxBytes: MAX_FOUND_BYTES }),
      ),
    );
  } catch (error) {
    console.error("Found conventions failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("found_failed", "We couldn't read those files.", 500);
  }
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
