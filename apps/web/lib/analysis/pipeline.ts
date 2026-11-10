import {
  analyzePrepared,
  ArchiveError,
  buildFileSet,
  extractTarGz,
  prepareSource,
  summarizeResult,
  type AnalysisResult,
  type FileSetOptions,
  type LimitExceeded,
  type PreparedFileSet,
  type ResultSummary,
} from "@reposcope/engine";
import type { ArchiveDownload } from "@/lib/github/archive";
import { ANALYSIS_VERSION } from "./claim";
import { prepareIncremental, snapshotOf, type IncrementalSource, type Snapshot } from "./snapshot";

export type RunStatus = "fetching" | "scanning" | "parsing" | "saving";

export type AnalysisStats = ResultSummary & {
  version: string;
  /** Set when only changed files were read, starting from the analysis of `from`. */
  incremental?: { from: string; parsed: number; reused: number };
};

/** Lets a run start from the last analysis's snapshot instead of the whole archive. */
export type SnapshotDeps = IncrementalSource & {
  commitSha: string;
  previous: () => Promise<Snapshot | null>;
  keep: (snapshot: Snapshot) => Promise<void>;
};

export type PipelineDeps = {
  download: () => Promise<ArchiveDownload>;
  setStatus: (status: RunStatus) => Promise<void>;
  save: (result: AnalysisResult) => Promise<void>;
  complete: (stats: AnalysisStats) => Promise<void>;
  fail: (message: string) => Promise<void>;
  snapshots?: SnapshotDeps;
};

const GENERIC_FAILURE = "The analysis failed unexpectedly. Try again in a moment.";

/** Runs one analysis. Every outcome ends in complete or fail, so a run can't silently stop. */
export async function runPipeline(deps: PipelineDeps, options: FileSetOptions = {}): Promise<void> {
  try {
    await deps.setStatus("fetching");
    const incremental = deps.snapshots ? await tryIncremental(deps.snapshots, options) : null;

    let prepared: PreparedFileSet;
    let snapshot: Snapshot | null = null;
    if (incremental?.ok) {
      ({ prepared, snapshot } = incremental);
    } else {
      const download = await deps.download();
      if (!download.ok) return await deps.fail(describeDownloadFailure(download));

      await deps.setStatus("scanning");
      const { files } = extractTarGz(download.bytes);
      const fileSet = buildFileSet(files, options);

      if (fileSet.limitExceeded) return await deps.fail(describeLimit(fileSet.limitExceeded));
      if (fileSet.sources.length === 0) {
        return await deps.fail("This repository has no JavaScript or TypeScript files to analyze.");
      }

      await deps.setStatus("parsing");
      prepared = { ...fileSet, sources: fileSet.sources.map(prepareSource) };
      if (deps.snapshots) {
        snapshot = snapshotOf(deps.snapshots.commitSha, files, fileSet, prepared.sources);
      }
    }

    const result = analyzePrepared(prepared);

    await deps.setStatus("saving");
    await deps.save(result);
    if (snapshot) {
      // The results are saved either way. Without a snapshot the next run reads the archive.
      await deps
        .snapshots!.keep(snapshot)
        .catch((error) =>
          console.error(
            "Could not keep snapshot:",
            error instanceof Error ? error.message : "unknown",
          ),
        );
    }
    await deps.complete({
      ...summarizeResult(result),
      version: ANALYSIS_VERSION,
      ...(incremental?.ok
        ? {
            incremental: {
              from: incremental.from,
              parsed: incremental.parsed,
              reused: incremental.reused,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ArchiveError) {
      return await deps.fail(
        error.code === "invalid_archive"
          ? "GitHub returned an archive RepoScope couldn't read."
          : "This repository is too large to analyze: it unpacks past the 300 MB limit.",
      );
    }
    console.error("Analysis failed:", error instanceof Error ? error.message : "unknown error");
    await deps.fail(GENERIC_FAILURE);
  }
}

/** Any doubt, or any error, means reading the archive instead, which is always right. */
async function tryIncremental(snapshots: SnapshotDeps, options: FileSetOptions) {
  try {
    const previous = await snapshots.previous();
    if (!previous) return null;
    const incremental = await prepareIncremental(previous, snapshots.commitSha, snapshots, options);
    if (!incremental.ok) {
      console.info(`Reading the whole archive: ${incremental.reason}.`);
      return null;
    }
    return { ...incremental, from: previous.commitSha };
  } catch (error) {
    console.error(
      "Incremental analysis failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return null;
  }
}

function describeDownloadFailure(download: Extract<ArchiveDownload, { ok: false }>): string {
  switch (download.error) {
    case "too_large":
      return "This repository is too large to analyze: its archive is over the 100 MB limit.";
    case "not_found":
      return "This repository is no longer available on GitHub.";
    case "rate_limited":
      return "GitHub's rate limit was reached. Try again later.";
    case "upstream":
      return "We couldn't download this repository from GitHub. Try again in a moment.";
  }
}

function describeLimit({ kind, limit, actual }: LimitExceeded): string {
  return kind === "source_files"
    ? `This repository has ${actual.toLocaleString("en-US")} JS/TS files. The limit is ${limit.toLocaleString("en-US")}.`
    : "This repository's source code is too large to analyze.";
}
