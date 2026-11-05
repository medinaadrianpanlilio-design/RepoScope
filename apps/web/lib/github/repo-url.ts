export type ParsedRepoUrl =
  | { ok: true; owner: string; repo: string }
  | { ok: false; reason: string };

const MAX_INPUT_LENGTH = 2048;
const OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/;
const INVALID = "Enter a GitHub repository URL like https://github.com/owner/repository.";

/**
 * Parses untrusted input into a GitHub owner and repository name. Only the
 * validated names leave this function, so a caller can never be tricked into
 * fetching a URL the user chose.
 */
export function parseGitHubRepoUrl(input: string): ParsedRepoUrl {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return { ok: false, reason: INVALID };

  const withScheme = trimmed.toLowerCase().startsWith("github.com/")
    ? `https://${trimmed}`
    : trimmed;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: INVALID };
  }

  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (host !== "github.com" && host !== "www.github.com") ||
    url.username ||
    url.password ||
    url.port
  ) {
    return { ok: false, reason: "Only https://github.com repository URLs are supported." };
  }

  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo) return { ok: false, reason: INVALID };

  const repo = rawRepo.replace(/\.git$/i, "");
  if (
    !OWNER_PATTERN.test(owner) ||
    !REPO_PATTERN.test(repo) ||
    repo === "." ||
    repo === ".."
  ) {
    return { ok: false, reason: INVALID };
  }

  return { ok: true, owner, repo };
}
