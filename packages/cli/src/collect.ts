import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { DEFAULT_EXCLUDED_DIRECTORIES } from "../../engine/src/index.ts";
import type { InputFile } from "../../engine/src/index.ts";
import type { GitRunner } from "./git.ts";

const READABLE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$|(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|[tj]sconfig(?:\.[\w-]+)?\.json)$/;

const EMPTY = new Uint8Array();

/** Only code and config are opened. Anything else, such as a .env file, is known by name only. */
export function isReadable(path: string): boolean {
  return READABLE.test(path);
}

function walk(folder: string, directory = folder, paths: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_EXCLUDED_DIRECTORIES.includes(entry.name)) walk(folder, path, paths);
    } else if (entry.isFile()) {
      paths.push(relative(folder, path).split(sep).join("/"));
    }
  }
  return paths;
}

/** Git's own list leaves out ignored files. A folder without git falls back to a walk. */
async function listPaths(folder: string, git: GitRunner): Promise<string[]> {
  try {
    const output = await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    return output.split("\0").filter(Boolean);
  } catch {
    return walk(folder);
  }
}

export async function collectFiles(folder: string, git: GitRunner): Promise<InputFile[]> {
  const files: InputFile[] = [];

  for (const path of await listPaths(folder, git)) {
    if (!isReadable(path)) {
      files.push({ path, bytes: EMPTY });
      continue;
    }
    try {
      files.push({ path, bytes: readFileSync(join(folder, path)) });
    } catch {
      // A tracked file deleted but not yet committed has nothing to read.
    }
  }
  return files;
}
