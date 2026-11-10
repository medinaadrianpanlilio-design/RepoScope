import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { getOptionalUser } from "@/lib/auth";
import { describeAccess, openRepository } from "@/lib/github/repository-access";
import { allowRequest } from "@/lib/rate-limit";
import { getRepository } from "@/lib/repositories/queries";
import { MissingSecretKeyError } from "@/lib/supabase/admin";

/**
 * Whether GitHub has commits newer than the latest analysis. GitHub doesn't retry a failed
 * webhook, so opening a repository asks. Reads nothing but the branch's latest commit.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/repositories/[id]/freshness">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  try {
    const repository = await getRepository(id);
    if (!repository) return notFound();
    if (repository.source === "local") {
      return apiError("local_repository", "Local folders update with reposcope sync.", 409);
    }

    if (!(await allowRequest("freshness", request.headers))) {
      return apiError("too_many_requests", "Too many checks. Try again later.", 429);
    }

    const user = await getOptionalUser();
    const access = await openRepository(repository, user?.id ?? null);
    if (!access.ok) {
      const failure = describeAccess(access.error);
      return apiError(failure.code, failure.message, failure.status);
    }

    const [commit, completed] = await Promise.all([
      access.reader.latestCommit(repository.default_branch),
      getLatestCompletedRun(id),
    ]);
    if (!commit.ok) {
      return commit.error === "rate_limited"
        ? apiError("rate_limited", "GitHub's rate limit was reached. Try again later.", 429)
        : apiError("github_unavailable", "We couldn't read this repository from GitHub.", 502);
    }

    const analyzed = completed?.commit_sha ?? null;
    return apiData({
      branch: repository.default_branch,
      latestCommit: commit.sha,
      analyzedCommit: analyzed,
      behind: analyzed !== null && analyzed !== commit.sha,
    });
  } catch (error) {
    if (error instanceof MissingSecretKeyError) {
      return apiError("not_configured", "Analysis isn't configured on this server yet.", 503);
    }
    console.error("Freshness check failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("freshness_failed", "We couldn't check GitHub for new commits.", 500);
  }
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
