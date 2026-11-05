import type { RepositoryLookup, RepositoryMetadata } from "@/lib/github/client";
import { parseGitHubRepoUrl } from "@/lib/github/repo-url";

export type ImportDeps = {
  lookup: (owner: string, repo: string) => Promise<RepositoryLookup>;
  upsert: (repository: RepositoryMetadata) => Promise<string>;
  save: (userId: string, repositoryId: string) => Promise<void>;
};

export type ImportResult =
  | { ok: true; repositoryId: string }
  | {
      ok: false;
      code: "invalid_url" | "not_found" | "rate_limited" | "github_unavailable";
      message: string;
      status: 400 | 404 | 429 | 502;
    };

export async function importRepository(
  { url, userId }: { url: string; userId: string | null },
  deps: ImportDeps,
): Promise<ImportResult> {
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_url", message: parsed.reason, status: 400 };
  }

  const lookup = await deps.lookup(parsed.owner, parsed.repo);
  if (!lookup.ok) return describeFailure(lookup);

  const repositoryId = await deps.upsert(lookup.repository);
  if (userId) await deps.save(userId, repositoryId);

  return { ok: true, repositoryId };
}

function describeFailure(lookup: Extract<RepositoryLookup, { ok: false }>): ImportResult {
  switch (lookup.error) {
    case "not_found":
      return {
        ok: false,
        code: "not_found",
        message: "We couldn't find that repository. It may not exist, or it may be private.",
        status: 404,
      };
    case "rate_limited":
      return {
        ok: false,
        code: "rate_limited",
        message: lookup.resetAt
          ? `GitHub's rate limit was reached. Try again after ${new Date(lookup.resetAt).toUTCString()}.`
          : "GitHub's rate limit was reached. Try again later.",
        status: 429,
      };
    case "upstream":
      return {
        ok: false,
        code: "github_unavailable",
        message: "We couldn't reach GitHub. Try again in a moment.",
        status: 502,
      };
  }
}
