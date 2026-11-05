import type { FileSet, InputFile, SkipReason, SkippedFile, SourceFile } from "./types.ts";

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
  const maxSourceFiles = options.maxSourceFiles ?? DEFAULT_MAX_SOURCE_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const sources: SourceFile[] = [];
  const configs = new Map<string, string>();
  const allPaths = new Set<string>();
  const skipped: SkippedFile[] = [];
  const decoder = new TextDecoder();
  const skip = (path: string, reason: SkipReason) => skipped.push({ path, reason });
  let sourceBytes = 0;

  for (const { path, bytes } of inputs) {
    if (!isSafePath(path)) continue;

    if (isInExcludedDirectory(path, excluded)) {
      skip(path, "excluded_directory");
      continue;
    }

    allPaths.add(path);

    if (LOCK_FILE.test(path)) {
      skip(path, "lock_file");
      continue;
    }

    if (CONFIG_FILE.test(path)) {
      if (bytes.length <= maxFileBytes) configs.set(path, decoder.decode(bytes));
      continue;
    }

    if (!SOURCE_EXTENSION.test(path)) continue;

    if (bytes.length > maxFileBytes) {
      skip(path, "too_large");
    } else if (isBinary(bytes)) {
      skip(path, "binary");
    } else {
      const content = decoder.decode(bytes);
      if (MINIFIED_NAME.test(path) || isMinified(content)) {
        skip(path, "minified");
      } else {
        sources.push({ path, content, size: bytes.length });
        sourceBytes += bytes.length;
      }
    }
  }

  const limitExceeded =
    sources.length > maxSourceFiles
      ? { kind: "source_files" as const, limit: maxSourceFiles, actual: sources.length }
      : sourceBytes > maxTotalBytes
        ? { kind: "total_bytes" as const, limit: maxTotalBytes, actual: sourceBytes }
        : null;

  return { sources, configs, allPaths, skipped, limitExceeded };
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
