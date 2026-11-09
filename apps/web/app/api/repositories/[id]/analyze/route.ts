import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { claimRun } from "@/lib/analysis/claim";
import { runPipeline } from "@/lib/analysis/pipeline";
import { runStore, runWriter } from "@/lib/analysis/store";
import { getOptionalUser } from "@/lib/auth";
import { describeAccess, openRepository } from "@/lib/github/repository-access";
import { allowRequest } from "@/lib/rate-limit";
import { getRepository } from "@/lib/repositories/queries";
import { MissingSecretKeyError } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/repositories/[id]/analyze">,
) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  try {
    const repository = await getRepository(id);
    if (!repository) return notFound();

    if (repository.source === "local") {
      return apiError("local_repository", "Local folders update with reposcope sync.", 409);
    }

    if (!(await allowRequest("analyze", request.headers))) {
      return apiError("too_many_requests", "Too many analyses. Try again in an hour.", 429);
    }

    const user = await getOptionalUser();
    const access = await openRepository(repository, user?.id ?? null);
    if (!access.ok) {
      const failure = describeAccess(access.error);
      return apiError(failure.code, failure.message, failure.status);
    }

    const { reader } = access;
    const commit = await reader.latestCommit(repository.default_branch);

    if (!commit.ok) {
      return commit.error === "rate_limited"
        ? apiError("rate_limited", "GitHub's rate limit was reached. Try again later.", 429)
        : apiError("github_unavailable", "We couldn't read this repository from GitHub.", 502);
    }

    const { run, start } = await claimRun(runStore(id, commit.sha));

    if (start) {
      after(() =>
        runPipeline({
          ...runWriter(run.id),
          download: () => reader.download(commit.sha),
        }),
      );
    }

    return apiData({ analysisId: run.id, commitSha: commit.sha, started: start }, 202);
  } catch (error) {
    if (error instanceof MissingSecretKeyError) {
      return apiError("not_configured", "Analysis isn't configured on this server yet.", 503);
    }
    console.error("Analyze failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("analyze_failed", "We couldn't start the analysis.", 500);
  }
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
