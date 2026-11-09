const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export type SourceFetch =
  | { ok: true; content: string }
  | { ok: false; error: "not_found" | "too_large" | "upstream" };

type Options = {
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  /** An installation token. Without one, only public files can be read. */
  token?: string;
};

/**
 * Reads one file at a fixed commit. Source is never stored, so it's fetched each time it's
 * viewed. Public files come from raw.githubusercontent.com, which doesn't count against the API
 * rate limit. Private files come from the contents API, so the token only ever goes to GitHub's API.
 */
export async function fetchSourceFile(
  owner: string,
  repo: string,
  commitSha: string,
  path: string,
  { maxBytes = DEFAULT_MAX_BYTES, fetchImpl = fetch, token }: Options = {},
): Promise<SourceFetch> {
  const parts = path.split("/");
  if (
    !OWNER_PATTERN.test(owner) ||
    !REPO_PATTERN.test(repo) ||
    !COMMIT_PATTERN.test(commitSha) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    return { ok: false, error: "not_found" };
  }

  const encodedPath = parts.map(encodeURIComponent).join("/");
  const url = token
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${commitSha}`
    : `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${encodedPath}`;
  const headers: Record<string, string> = token
    ? {
        accept: "application/vnd.github.raw+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "RepoScope",
      }
    : { "user-agent": "RepoScope" };

  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (response.status === 404) return { ok: false, error: "not_found" };
    if (!response.ok || !response.body) return { ok: false, error: "upstream" };

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }

    return { ok: true, content: Buffer.concat(chunks).toString("utf8") };
  } catch {
    return { ok: false, error: "upstream" };
  }
}
