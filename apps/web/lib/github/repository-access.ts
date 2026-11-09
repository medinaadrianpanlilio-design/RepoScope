import "server-only";
import type { TokenError } from "./app-auth";
import { fetchRepositoryMetadata, type RepositoryMetadata } from "./client";
import { installationForAccount, installationOf, openTokenSource } from "./installation-tokens";
import { privateReader, publicReader, type RepositoryReader } from "./reader";

export type AccessError = TokenError | "rate_limited" | "not_found";

export type Access = { ok: true; reader: RepositoryReader } | { ok: false; error: AccessError };

type Stored = {
  owner: string;
  name: string;
  github_id: number | null;
  installation_id: string | null;
};

/**
 * Opens a repository for one request or one analysis. A private one gets a fresh token limited to
 * that repository, so GitHub rechecks access every time and the token dies with the job.
 */
export async function openRepository(repository: Stored, userId: string | null): Promise<Access> {
  if (!repository.installation_id) {
    return { ok: true, reader: publicReader(repository, { token: process.env.GITHUB_TOKEN }) };
  }
  if (!userId || repository.github_id === null) return { ok: false, error: "not_found" };

  // The server client bypasses Row Level Security, so this lookup is filtered by the user.
  const installation = await installationOf(userId, repository.installation_id);
  if (!installation) return { ok: false, error: "not_found" };

  const issued = await openTokenSource(installation, { repositoryIds: [repository.github_id] })();
  if (!issued.ok) return { ok: false, error: issued.error };
  return { ok: true, reader: privateReader(repository, issued.token) };
}

export type PrivateFound = { repository: RepositoryMetadata; installationId: string };

export type PrivateLookup =
  | { ok: true; found: PrivateFound }
  | { ok: false; error: AccessError | "not_connected" | "upstream" };

/** Looks for a repository through the user's own installation on its account. */
export async function findPrivateRepository(
  userId: string,
  owner: string,
  repo: string,
): Promise<PrivateLookup> {
  const installation = await installationForAccount(userId, owner);
  if (!installation) return { ok: false, error: "not_connected" };

  const issued = await openTokenSource(installation)();
  if (!issued.ok) return { ok: false, error: issued.error };

  const lookup = await fetchRepositoryMetadata(owner, repo, {
    token: issued.token.reveal(),
    allowPrivate: true,
  });
  if (!lookup.ok) return { ok: false, error: lookup.error };
  return { ok: true, found: { repository: lookup.repository, installationId: installation.id } };
}

type Failure = { code: string; message: string; status: 403 | 404 | 429 | 502 | 503 };

/** What to tell someone whose private repository can't be read right now. */
export function describeAccess(error: AccessError | "not_connected"): Failure {
  switch (error) {
    case "not_found":
      return { code: "not_found", message: "Repository not found.", status: 404 };
    case "not_connected":
      return {
        code: "not_connected",
        message:
          "We couldn't find that repository. If it's private, connect its GitHub account on your dashboard first.",
        status: 404,
      };
    case "revoked":
      return {
        code: "github_revoked",
        message: "RepoScope was uninstalled from this GitHub account. Connect it again from your dashboard.",
        status: 403,
      };
    case "suspended":
      return {
        code: "github_suspended",
        message: "The RepoScope App is suspended on this GitHub account. Unsuspend it on GitHub.",
        status: 403,
      };
    case "no_access":
      return {
        code: "github_no_access",
        message:
          "RepoScope can't see this repository on GitHub anymore. Choose it again in the App's settings on GitHub.",
        status: 403,
      };
    case "under_permissioned":
      return {
        code: "github_permissions",
        message: "The App's permissions changed and haven't been accepted on GitHub. Accept them there.",
        status: 403,
      };
    case "not_configured":
      return {
        code: "not_configured",
        message: "The GitHub App isn't set up correctly on this server.",
        status: 503,
      };
    case "rate_limited":
      return {
        code: "rate_limited",
        message: "GitHub's rate limit was reached. Try again later.",
        status: 429,
      };
    case "upstream":
      return {
        code: "github_unavailable",
        message: "We couldn't reach GitHub. Try again in a moment.",
        status: 502,
      };
  }
}
