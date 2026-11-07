import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;

const repositoryResponse = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  html_url: z.string(),
  description: z.string().nullable(),
  default_branch: z.string(),
  language: z.string().nullable(),
  private: z.boolean(),
});

export type RepositoryMetadata = {
  githubId: number;
  owner: string;
  name: string;
  fullName: string;
  githubUrl: string;
  description: string | null;
  defaultBranch: string;
  primaryLanguage: string | null;
  isPrivate: boolean;
};

export type RepositoryLookup =
  | { ok: true; repository: RepositoryMetadata }
  | { ok: false; error: "not_found" | "upstream" }
  | { ok: false; error: "rate_limited"; resetAt: string | null };

export type CommitLookup =
  | { ok: true; sha: string }
  | { ok: false; error: "not_found" | "upstream" }
  | { ok: false; error: "rate_limited"; resetAt: string | null };

type Options = {
  token?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchRepositoryMetadata(
  owner: string,
  repo: string,
  { token, fetchImpl = fetch }: Options = {},
): Promise<RepositoryLookup> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "RepoScope",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "upstream" };
  }

  if (response.status === 404) return { ok: false, error: "not_found" };

  if (isRateLimited(response)) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return {
      ok: false,
      error: "rate_limited",
      resetAt: reset ? new Date(reset * 1000).toISOString() : null,
    };
  }

  if (!response.ok) return { ok: false, error: "upstream" };

  const parsed = repositoryResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: "upstream" };

  const data = parsed.data;
  // Private repositories arrive with the GitHub App in Phase 8. Until then a server
  // token must never pull one into the public catalog.
  if (data.private) return { ok: false, error: "not_found" };

  return {
    ok: true,
    repository: {
      githubId: data.id,
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      githubUrl: data.html_url,
      description: data.description,
      defaultBranch: data.default_branch,
      primaryLanguage: data.language,
      isPrivate: data.private,
    },
  };
}

/** Resolves a branch to the commit it points at right now. */
export async function fetchLatestCommit(
  owner: string,
  repo: string,
  branch: string,
  { token, fetchImpl = fetch }: Options = {},
): Promise<CommitLookup> {
  const path = [owner, repo].map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${path}/commits/${encodeURIComponent(branch)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github.sha",
        "x-github-api-version": "2022-11-28",
        "user-agent": "RepoScope",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "upstream" };
  }

  if (response.status === 404 || response.status === 422) return { ok: false, error: "not_found" };

  if (isRateLimited(response)) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return {
      ok: false,
      error: "rate_limited",
      resetAt: reset ? new Date(reset * 1000).toISOString() : null,
    };
  }

  const sha = response.ok ? (await response.text()).trim() : "";
  return /^[0-9a-f]{40}$/.test(sha) ? { ok: true, sha } : { ok: false, error: "upstream" };
}

function isRateLimited(response: Response): boolean {
  if (response.status !== 403 && response.status !== 429) return false;
  return (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.has("retry-after")
  );
}
