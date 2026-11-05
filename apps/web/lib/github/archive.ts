const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const ARCHIVE_HOST = "codeload.github.com";
const OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export type ArchiveDownload =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: "not_found" | "too_large" | "upstream" }
  | { ok: false; error: "rate_limited"; resetAt: string | null };

type Options = {
  token?: string;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Downloads the gzipped tarball of one commit. Only validated names reach the URL, and the
 * redirect GitHub answers with is followed only when it stays on codeload.github.com, so the
 * server can't be steered to another host. The token goes to api.github.com and is never
 * forwarded to the redirect target.
 */
export async function downloadArchive(
  owner: string,
  repo: string,
  commitSha: string,
  { token, maxBytes = DEFAULT_MAX_ARCHIVE_BYTES, fetchImpl = fetch }: Options = {},
): Promise<ArchiveDownload> {
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || !COMMIT_PATTERN.test(commitSha)) {
    return { ok: false, error: "not_found" };
  }

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${commitSha}`;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    const first = await fetchImpl(apiUrl, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "RepoScope",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "manual",
      signal,
      cache: "no-store",
    });

    if (first.status === 404) return { ok: false, error: "not_found" };
    if (isRateLimited(first)) return rateLimited(first);
    if (first.status !== 302) return { ok: false, error: "upstream" };

    const target = safeRedirect(first.headers.get("location"));
    if (!target) return { ok: false, error: "upstream" };

    const second = await fetchImpl(target, {
      headers: { "user-agent": "RepoScope" },
      redirect: "error",
      signal,
      cache: "no-store",
    });

    if (second.status === 404) return { ok: false, error: "not_found" };
    if (!second.ok || !second.body) return { ok: false, error: "upstream" };

    const declared = Number(second.headers.get("content-length"));
    if (declared > maxBytes) {
      await second.body.cancel();
      return { ok: false, error: "too_large" };
    }

    return await readLimited(second.body, maxBytes);
  } catch {
    return { ok: false, error: "upstream" };
  }
}

function safeRedirect(location: string | null): string | null {
  if (!location) return null;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== ARCHIVE_HOST || url.port) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

async function readLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<ArchiveDownload> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, error: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { ok: true, bytes };
}

function rateLimited(response: Response): ArchiveDownload {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return {
    ok: false,
    error: "rate_limited",
    resetAt: reset ? new Date(reset * 1000).toISOString() : null,
  };
}

function isRateLimited(response: Response): boolean {
  if (response.status !== 403 && response.status !== 429) return false;
  return (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.has("retry-after")
  );
}
