import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** install-hook writes this file, and it shouldn't make every folder look edited. */
const HOOK_SETTINGS_EXCLUDED = ":(exclude).claude/settings.local.json";

export type GitRunner = (args: string[]) => Promise<string>;

export type GitInfo = {
  commit: string | null;
  branch: string | null;
  dirty: boolean;
  remote: string | null;
};

/** safe.directory stops git refusing folders on drives that don't record file owners. */
export function runnerFor(folder: string): GitRunner {
  return async (args) => {
    const { stdout } = await exec("git", ["-c", "safe.directory=*", "-C", folder, ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  };
}

export function parseRemote(url: string): string | null {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function folderName(folder: string): string {
  const name = basename(folder.replace(/[\\/]+$/, "").replace(/\\/g, "/"));
  return name.replace(/[^\w.-]+/g, "-").slice(0, 100) || "folder";
}

async function attempt(run: GitRunner, args: string[]): Promise<string | null> {
  try {
    return (await run(args)).trim();
  } catch {
    return null;
  }
}

export async function gitInfo(run: GitRunner): Promise<GitInfo> {
  const commit = await attempt(run, ["rev-parse", "HEAD"]);
  if (!commit) return { commit: null, branch: null, dirty: true, remote: null };

  const [branch, status, remote] = await Promise.all([
    attempt(run, ["rev-parse", "--abbrev-ref", "HEAD"]),
    attempt(run, ["status", "--porcelain", "--", ".", HOOK_SETTINGS_EXCLUDED]),
    attempt(run, ["remote", "get-url", "origin"]),
  ]);

  return { commit, branch, dirty: status !== "", remote: remote ? parseRemote(remote) : null };
}
