import type { RepositoryLookup, RepositoryMetadata } from "@/lib/github/client";
import { parseGitHubRepoUrl } from "@/lib/github/repo-url";
import type { AccessError, PrivateFound, PrivateLookup } from "@/lib/github/repository-access";

export type ImportDeps = {
  allow: () => Promise<boolean>;
  lookup: (owner: string, repo: string) => Promise<RepositoryLookup>;
  upsert: (repository: RepositoryMetadata) => Promise<string>;
  save: (userId: string, repositoryId: string) => Promise<void>;
  /** Only for a signed-in user: their own connected GitHub accounts. */
  private?: {
    lookup: (owner: string, repo: string) => Promise<PrivateLookup>;
    /** Returns null when another user owns the repository. */
    upsert: (found: PrivateFound) => Promise<string | null>;
    describe: (error: AccessError | "not_connected") => { code: string; message: string; status: number };
  };
};

export type ImportResult =
  | { ok: true; repositoryId: string }
  | { ok: false; code: string; message: string; status: number };

const UNREACHABLE =
  "RepoScope can't see that repository. If it's yours, choose it in the App's settings on GitHub.";

export async function importRepository(
  { url, userId }: { url: string; userId: string | null },
  deps: ImportDeps,
): Promise<ImportResult> {
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_url", message: parsed.reason, status: 400 };
  }

  if (!(await deps.allow())) {
    return {
      ok: false,
      code: "too_many_requests",
      message: "Too many imports. Try again in an hour.",
      status: 429,
    };
  }

  const lookup = await deps.lookup(parsed.owner, parsed.repo);
  if (lookup.ok || lookup.error !== "not_found" || !userId || !deps.private) {
    if (!lookup.ok) return describeFailure(lookup);
    const repositoryId = await deps.upsert(lookup.repository);
    if (userId) await deps.save(userId, repositoryId);
    return { ok: true, repositoryId };
  }

  // The server's token can't see it, so it may be private on an account this user connected.
  const found = await deps.private.lookup(parsed.owner, parsed.repo);
  if (!found.ok) {
    if (found.error === "not_found") {
      return { ok: false, code: "not_found", message: UNREACHABLE, status: 404 };
    }
    const failure = deps.private.describe(found.error);
    return { ok: false, ...failure };
  }

  const repositoryId = found.found.repository.isPrivate
    ? await deps.private.upsert(found.found)
    : await deps.upsert(found.found.repository);
  if (!repositoryId) return { ok: false, code: "not_found", message: UNREACHABLE, status: 404 };

  await deps.save(userId, repositoryId);
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
