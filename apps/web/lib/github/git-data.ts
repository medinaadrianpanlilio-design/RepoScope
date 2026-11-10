import { z } from "zod";

const REQUEST_TIMEOUT_MS = 15_000;
/** GitHub stops listing a tree at 7 MB, so a bigger answer isn't a tree. */
const MAX_TREE_BYTES = 8 * 1024 * 1024;
const OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** A file in a commit. Git names its content by a hash, so an unchanged file keeps its sha. */
export type TreeFile = { path: string; sha: string; size: number };

export type TreeLookup =
  | { ok: true; files: TreeFile[]; entries: number }
  | { ok: false; error: "not_found" | "truncated" | "upstream" };

export type BlobFetch =
  { ok: true; bytes: Uint8Array } | { ok: false; error: "not_found" | "too_large" | "upstream" };

type Options = { token?: string; fetchImpl?: typeof fetch };

const treeResponse = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.string(),
      sha: z.string(),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});

/** Regular files only: GitHub's archives leave out links and submodules, and so does this. */
const REGULAR_FILE = new Set(["100644", "100755"]);

/** Every file in a commit, with its size and content hash, in one request. */
export async function fetchTree(
  owner: string,
  repo: string,
  commitSha: string,
  options: Options = {},
): Promise<TreeLookup> {
  if (!validTarget(owner, repo, commitSha)) return { ok: false, error: "not_found" };

  const response = await request(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
    "application/vnd.github+json",
    options,
  );
  if (!response) return { ok: false, error: "upstream" };
  if (response.status === 404 || response.status === 422) return { ok: false, error: "not_found" };
  if (!response.ok) return { ok: false, error: "upstream" };

  const body = await readCapped(response, MAX_TREE_BYTES);
  if (!(body instanceof Uint8Array)) return { ok: false, error: "upstream" };

  let parsed;
  try {
    parsed = treeResponse.safeParse(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    return { ok: false, error: "upstream" };
  }
  if (!parsed.success) return { ok: false, error: "upstream" };
  if (parsed.data.truncated) return { ok: false, error: "truncated" };

  const files: TreeFile[] = [];
  for (const entry of parsed.data.tree) {
    if (entry.type !== "blob" || !REGULAR_FILE.has(entry.mode)) continue;
    if (!SHA_PATTERN.test(entry.sha) || entry.size === undefined)
      return { ok: false, error: "upstream" };
    files.push({ path: entry.path, sha: entry.sha, size: entry.size });
  }
  return { ok: true, files, entries: parsed.data.tree.length };
}

/** One file's bytes by its content hash. */
export async function fetchBlob(
  owner: string,
  repo: string,
  blobSha: string,
  { maxBytes, ...options }: Options & { maxBytes: number },
): Promise<BlobFetch> {
  if (!validTarget(owner, repo, blobSha)) return { ok: false, error: "not_found" };

  const response = await request(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`,
    "application/vnd.github.raw+json",
    options,
  );
  if (!response) return { ok: false, error: "upstream" };
  if (response.status === 404 || response.status === 422) return { ok: false, error: "not_found" };
  if (!response.ok) return { ok: false, error: "upstream" };

  const bytes = await readCapped(response, maxBytes);
  return bytes instanceof Uint8Array ? { ok: true, bytes } : { ok: false, error: bytes };
}

function validTarget(owner: string, repo: string, sha: string) {
  return OWNER_PATTERN.test(owner) && REPO_PATTERN.test(repo) && SHA_PATTERN.test(sha);
}

async function request(url: string, accept: string, { token, fetchImpl = fetch }: Options) {
  try {
    return await fetchImpl(url, {
      headers: {
        accept,
        "x-github-api-version": "2022-11-28",
        "user-agent": "RepoScope",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** Reads a body, giving up past the limit so a huge answer can't fill memory. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | "too_large" | "upstream"> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    return "upstream";
  }
  return new Uint8Array(Buffer.concat(chunks));
}
