import type { FileSet, InputFile, LimitExceeded, SkipReason, SkippedFile, SourceFile } from "./types.ts";

export type FileSetOptions = {
  excludedDirectories?: string[];
  maxFileBytes?: number;
  maxSourceFiles?: number;
  maxTotalBytes?: number;
};

export const DEFAULT_EXCLUDED_DIRECTORIES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
];

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_SOURCE_FILES = 2000;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const CONFIG_FILE =
  /(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|jsconfig\.json|tsconfig(?:\.[\w-]+)?\.json)$/;
const LOCK_FILE =
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/;
const MINIFIED_NAME = /\.min\.[cm]?js$/;

const BINARY_SAMPLE_BYTES = 8000;
const MINIFIED_LINE_LENGTH = 5000;

export function buildFileSet(inputs: InputFile[], options: FileSetOptions = {}): FileSet {
  const excluded = new Set(options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRECTORIES);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxSourceFiles = options.maxSourceFiles;
  const maxTotalBytes = options.maxTotalBytes;

  const sources: SourceFile[] = [];
  const configs = new Map<string, string>();
  const allPaths = new Set<string>();
  const skipped: SkippedFile[] = [];
  const decoder = new TextDecoder();
  const skip = (path: string, reason: SkipReason) => skipped.push({ path, reason });
  let sourceBytes = 0;

  for (const { path, bytes } of inputs) {
    const place = placePath(path, bytes.length, { excluded, maxFileBytes });
    if (place.kind === "unsafe") continue;
    if (place.kind === "excluded") {
      skip(path, "excluded_directory");
      continue;
    }

    allPaths.add(path);

    if (place.kind === "skipped") skip(path, place.reason);
    else if (place.kind === "config") configs.set(path, decoder.decode(bytes));
    else if (place.kind === "content") {
      const read = readContent(path, bytes);
      if (read.kind === "skipped") skip(path, read.reason);
      else {
        sources.push({ path, content: read.content, size: bytes.length });
        sourceBytes += bytes.length;
      }
    }
  }

  return {
    sources,
    configs,
    allPaths,
    skipped,
    limitExceeded: checkLimits(sources.length, sourceBytes, { maxSourceFiles, maxTotalBytes }),
  };
}

export type PathPlace =
  | { kind: "unsafe" }
  | { kind: "excluded" }
  | { kind: "skipped"; reason: "lock_file" | "too_large" }
  | { kind: "config" }
  | { kind: "other" }
  /** A source file, which needs its bytes to decide whether it can be read. */
  | { kind: "content" };

/**
 * Decides what a file is from its path and size alone. Paired with readContent, it makes the
 * same decisions as buildFileSet, so a set can be rebuilt from a file list and a few changed files.
 */
export function placePath(
  path: string,
  size: number,
  options: { excluded?: Set<string>; maxFileBytes?: number } = {},
): PathPlace {
  const excluded = options.excluded ?? new Set(DEFAULT_EXCLUDED_DIRECTORIES);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (!isSafePath(path)) return { kind: "unsafe" };
  if (isInExcludedDirectory(path, excluded)) return { kind: "excluded" };
  if (LOCK_FILE.test(path)) return { kind: "skipped", reason: "lock_file" };
  if (CONFIG_FILE.test(path)) return size <= maxFileBytes ? { kind: "config" } : { kind: "other" };
  if (!SOURCE_EXTENSION.test(path)) return { kind: "other" };
  if (size > maxFileBytes) return { kind: "skipped", reason: "too_large" };
  return { kind: "content" };
}

export function readContent(
  path: string,
  bytes: Uint8Array,
): { kind: "source"; content: string } | { kind: "skipped"; reason: "binary" | "minified" } {
  if (isBinary(bytes)) return { kind: "skipped", reason: "binary" };
  const content = new TextDecoder().decode(bytes);
  if (MINIFIED_NAME.test(path) || isMinified(content)) return { kind: "skipped", reason: "minified" };
  return { kind: "source", content };
}

export function checkLimits(
  sourceFiles: number,
  sourceBytes: number,
  options: { maxSourceFiles?: number; maxTotalBytes?: number } = {},
): LimitExceeded | null {
  const maxSourceFiles = options.maxSourceFiles ?? DEFAULT_MAX_SOURCE_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  if (sourceFiles > maxSourceFiles) {
    return { kind: "source_files", limit: maxSourceFiles, actual: sourceFiles };
  }
  if (sourceBytes > maxTotalBytes) {
    return { kind: "total_bytes", limit: maxTotalBytes, actual: sourceBytes };
  }
  return null;
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => part === ".." || part === "." || part === "")
  );
}

function isInExcludedDirectory(path: string, excluded: Set<string>): boolean {
  return path.split("/").slice(0, -1).some((part) => excluded.has(part));
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0);
}

function isMinified(content: string): boolean {
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    if (lineEnd - lineStart > MINIFIED_LINE_LENGTH) return true;
    lineStart = lineEnd + 1;
  }
  return false;
}
