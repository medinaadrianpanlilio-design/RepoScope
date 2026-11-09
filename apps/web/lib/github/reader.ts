import type { GitHubToken } from "./app-auth";
import { downloadArchive, type ArchiveDownload } from "./archive";
import { fetchLatestCommit, type CommitLookup } from "./client";
import { fetchSourceFile, type SourceFetch } from "./raw";

/**
 * Everything RepoScope reads from a repository on GitHub. Analysis and source viewing use only
 * this, so a public and a private repository go through the same steps and differ only in the token.
 */
export type RepositoryReader = {
  latestCommit(branch: string): Promise<CommitLookup>;
  download(commitSha: string): Promise<ArchiveDownload>;
  file(commitSha: string, path: string, options?: { maxBytes?: number }): Promise<SourceFetch>;
};

type Target = { owner: string; name: string };
type Options = { fetchImpl?: typeof fetch };

/** The server's own token, if any, raises the rate limit. Files come without one. */
export function publicReader(
  { owner, name }: Target,
  { token, fetchImpl }: Options & { token?: string } = {},
): RepositoryReader {
  return {
    latestCommit: (branch) => fetchLatestCommit(owner, name, branch, { token, fetchImpl }),
    download: (sha) => downloadArchive(owner, name, sha, { token, fetchImpl }),
    file: (sha, path, options) => fetchSourceFile(owner, name, sha, path, { ...options, fetchImpl }),
  };
}

/** The token is revealed only at the moment each request is sent. */
export function privateReader(
  { owner, name }: Target,
  token: GitHubToken,
  { fetchImpl }: Options = {},
): RepositoryReader {
  return {
    latestCommit: (branch) =>
      fetchLatestCommit(owner, name, branch, { token: token.reveal(), fetchImpl }),
    download: (sha) => downloadArchive(owner, name, sha, { token: token.reveal(), fetchImpl }),
    file: (sha, path, options) =>
      fetchSourceFile(owner, name, sha, path, { ...options, token: token.reveal(), fetchImpl }),
  };
}
