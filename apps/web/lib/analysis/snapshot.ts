import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  checkLimits,
  DEFAULT_EXCLUDED_DIRECTORIES,
  placePath,
  prepareSource,
  readContent,
  type FileSet,
  type FileSetOptions,
  type InputFile,
  type PreparedFileSet,
  type PreparedSource,
  type SkippedFile,
} from "@reposcope/engine";
import { z } from "zod";
import type { BlobFetch, TreeLookup } from "@/lib/github/git-data";
import { ANALYSIS_VERSION } from "./claim";

/**
 * What one analysis keeps so the next can skip unchanged files: each source file's parse result
 * and content hash. Source code itself is never kept: config files are fetched again each time.
 */
export type Snapshot = {
  format: 1;
  analysisVersion: string;
  commitSha: string;
  sources: (PreparedSource & { sha: string })[];
  /** Source files skipped for their content, which only changes when their hash does. */
  contentSkips: { path: string; sha: string; reason: "binary" | "minified" }[];
  /** .gitattributes files known to change nothing in GitHub's archive. */
  attributes: string[];
};

export type IncrementalSource = {
  tree(commitSha: string): Promise<TreeLookup>;
  blob(blobSha: string, maxBytes: number): Promise<BlobFetch>;
};

export type Incremental =
  | {
      ok: true;
      prepared: PreparedFileSet;
      snapshot: Snapshot;
      parsed: number;
      reused: number;
    }
  | { ok: false; reason: string };

/** Past this many files to fetch, one archive download is cheaper and simpler. */
export const MAX_FETCHED_FILES = 300;
const FETCH_CONCURRENCY = 8;
/** The same limits the archive path enforces, so a repository fails the same way either way. */
const MAX_ENTRIES = 200_000;
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
/** export-ignore and export-subst make GitHub's archive differ from the commit's files. */
const ARCHIVE_RULE = /\bexport-(?:ignore|subst)\b/;
const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;

/** Git's own name for a file's content, so it can be matched against a commit's tree. */
export function blobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

const isAttributes = (path: string) =>
  path === ".gitattributes" || path.endsWith("/.gitattributes");

/**
 * Builds the snapshot of an analysis read from GitHub's archive. Returns null when the
 * repository's .gitattributes change the archive, since then only the archive gives true results.
 */
export function snapshotOf(
  commitSha: string,
  inputs: InputFile[],
  fileSet: FileSet,
  sources: PreparedSource[],
): Snapshot | null {
  const bytesOf = new Map(inputs.map((file) => [file.path, file.bytes]));
  const attributes: string[] = [];
  for (const { path, bytes } of inputs) {
    if (!isAttributes(path)) continue;
    if (ARCHIVE_RULE.test(new TextDecoder().decode(bytes))) return null;
    attributes.push(blobSha(bytes));
  }

  return {
    format: 1,
    analysisVersion: ANALYSIS_VERSION,
    commitSha,
    sources: sources.map((source) => ({
      ...source,
      sha: blobSha(bytesOf.get(source.path)!),
    })),
    contentSkips: fileSet.skipped.flatMap(({ path, reason }) =>
      reason === "binary" || reason === "minified"
        ? [{ path, reason, sha: blobSha(bytesOf.get(path)!) }]
        : [],
    ),
    attributes,
  };
}

/**
 * Rebuilds a commit's file set from the last snapshot, fetching only files whose hash changed.
 * Every decision goes through the engine's own placePath and readContent, so the set matches
 * what the archive would give. Anything it can't be sure of returns a reason to run in full.
 */
export async function prepareIncremental(
  previous: Snapshot,
  commitSha: string,
  source: IncrementalSource,
  options: FileSetOptions = {},
): Promise<Incremental> {
  const fallback = (reason: string): Incremental => ({ ok: false, reason });
  if (previous.format !== 1 || previous.analysisVersion !== ANALYSIS_VERSION) {
    return fallback("the last analysis is from an older version");
  }
  if (previous.commitSha === commitSha) return fallback("same commit");

  const tree = await source.tree(commitSha);
  if (!tree.ok) return fallback(`file list ${tree.error}`);
  if (tree.entries > MAX_ENTRIES) return fallback("too many files");
  if (tree.files.reduce((sum, file) => sum + file.size, 0) > MAX_UNPACKED_BYTES) {
    return fallback("too large");
  }

  const excluded = new Set(options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRECTORIES);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const known = new Map(previous.sources.map((file) => [file.path, file]));
  const knownSkips = new Map(previous.contentSkips.map((file) => [file.path, file]));
  const cleanAttributes = new Set(previous.attributes);

  const sources: Snapshot["sources"] = [];
  const contentSkips: Snapshot["contentSkips"] = [];
  const skipped: SkippedFile[] = [];
  const allPaths = new Set<string>();
  const wanted: {
    path: string;
    sha: string;
    size: number;
    use: "config" | "content" | "attributes";
  }[] = [];

  for (const file of tree.files) {
    if (isAttributes(file.path) && !cleanAttributes.has(file.sha)) {
      if (file.size > maxFileBytes) return fallback(".gitattributes too large to check");
      wanted.push({ ...file, use: "attributes" });
    }

    const place = placePath(file.path, file.size, { excluded, maxFileBytes });
    if (place.kind === "unsafe") continue;
    if (place.kind === "excluded") {
      skipped.push({ path: file.path, reason: "excluded_directory" });
      continue;
    }
    allPaths.add(file.path);

    if (place.kind === "skipped") skipped.push({ path: file.path, reason: place.reason });
    else if (place.kind === "config") wanted.push({ ...file, use: "config" });
    else if (place.kind === "content") {
      const source = known.get(file.path);
      const skip = knownSkips.get(file.path);
      if (source?.sha === file.sha) sources.push(source);
      else if (skip?.sha === file.sha) contentSkips.push(skip);
      else wanted.push({ ...file, use: "content" });
    }
  }

  if (wanted.length > MAX_FETCHED_FILES) return fallback("too many changed files");

  const fetched = await mapLimit(wanted, FETCH_CONCURRENCY, (file) =>
    source.blob(file.sha, maxFileBytes),
  );

  const configs = new Map<string, string>();
  let parsed = 0;
  for (const [index, file] of wanted.entries()) {
    const result = fetched[index]!;
    if (!result.ok) return fallback(`a file couldn't be read (${result.error})`);
    // A file's hash is its content, so a different answer means it isn't the file asked for.
    if (blobSha(result.bytes) !== file.sha) return fallback("a file didn't match its hash");

    if (file.use === "attributes") {
      if (ARCHIVE_RULE.test(new TextDecoder().decode(result.bytes))) {
        return fallback(".gitattributes changes the archive");
      }
    } else if (file.use === "config") {
      configs.set(file.path, new TextDecoder().decode(result.bytes));
    } else {
      const read = readContent(file.path, result.bytes);
      if (read.kind === "skipped") {
        contentSkips.push({
          path: file.path,
          sha: file.sha,
          reason: read.reason,
        });
      } else {
        sources.push({
          ...prepareSource({
            path: file.path,
            content: read.content,
            size: file.size,
          }),
          sha: file.sha,
        });
        parsed++;
      }
    }
  }

  const sourceBytes = sources.reduce((sum, file) => sum + file.size, 0);
  // The archive path reports these, so let it.
  if (checkLimits(sources.length, sourceBytes, options) || sources.length === 0) {
    return fallback("outside the analysis limits");
  }

  const attributes = tree.files.filter((file) => isAttributes(file.path)).map((file) => file.sha);
  return {
    ok: true,
    prepared: {
      sources,
      configs,
      allPaths,
      skipped: [...skipped, ...contentSkips.map(({ path, reason }) => ({ path, reason }))],
    },
    snapshot: {
      format: 1,
      analysisVersion: ANALYSIS_VERSION,
      commitSha,
      sources,
      contentSkips,
      attributes,
    },
    parsed,
    reused: sources.length - parsed,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const snapshotSchema = z.object({
  format: z.literal(1),
  analysisVersion: z.string(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  sources: z.array(
    z.object({
      path: z.string(),
      sha: z.string(),
      size: z.number(),
      lines: z.number(),
      parsed: z.object({
        imports: z.array(
          z.object({
            specifier: z.string(),
            type: z.enum(["static", "dynamic", "reexport", "type"]),
            line: z.number(),
          }),
        ),
        exports: z.array(z.string()),
        unanalyzable: z.array(z.object({ expression: z.string(), line: z.number() })),
        hasSyntaxErrors: z.boolean(),
      }),
    }),
  ),
  contentSkips: z.array(
    z.object({
      path: z.string(),
      sha: z.string(),
      reason: z.enum(["binary", "minified"]),
    }),
  ),
  attributes: z.array(z.string()),
});

/** Compressed, since a large repository's parse results are mostly repeated names. */
export function encodeSnapshot(snapshot: Snapshot): string {
  return gzipSync(JSON.stringify(snapshot)).toString("base64");
}

/** Returns null for anything that isn't a snapshot this version can use. */
export function decodeSnapshot(data: string): Snapshot | null {
  try {
    const parsed = snapshotSchema.safeParse(
      JSON.parse(
        gunzipSync(Buffer.from(data, "base64"), {
          maxOutputLength: MAX_SNAPSHOT_BYTES,
        }).toString(),
      ),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
