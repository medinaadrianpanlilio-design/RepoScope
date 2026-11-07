import {
  analyzeFileSet,
  ArchiveError,
  buildFileSet,
  extractTarGz,
  type AnalysisResult,
  type FileSetOptions,
  type LimitExceeded,
} from "@reposcope/engine";
import type { ArchiveDownload } from "@/lib/github/archive";

export type RunStatus = "fetching" | "scanning" | "parsing" | "saving";

const MAX_STORED_DIRECTORIES = 50;
const MAX_STORED_CYCLES = 100;
const MAX_STORED_UNANALYZABLE = 100;

export type AnalysisStats = Pick<AnalysisResult, "totals" | "languages" | "directories" | "cycles"> & {
  cycleCount: number;
  externalPackages: string[];
  unanalyzable: AnalysisResult["unanalyzable"];
  unanalyzableCount: number;
};

export type PipelineDeps = {
  download: () => Promise<ArchiveDownload>;
  setStatus: (status: RunStatus) => Promise<void>;
  save: (result: AnalysisResult) => Promise<void>;
  complete: (stats: AnalysisStats) => Promise<void>;
  fail: (message: string) => Promise<void>;
};

const GENERIC_FAILURE = "The analysis failed unexpectedly. Try again in a moment.";

/** Runs one analysis. Every outcome ends in complete or fail, so a run can't silently stop. */
export async function runPipeline(deps: PipelineDeps, options: FileSetOptions = {}): Promise<void> {
  try {
    await deps.setStatus("fetching");
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
    const result = analyzeFileSet(fileSet);

    await deps.setStatus("saving");
    await deps.save(result);
    await deps.complete(toStats(result));
  } catch (error) {
    if (error instanceof ArchiveError) {
      return await deps.fail(
        error.code === "invalid_archive"
          ? "GitHub returned an archive RepoScope couldn't read."
          : "This repository is too large to analyze.",
      );
    }
    console.error("Analysis failed:", error instanceof Error ? error.message : "unknown error");
    await deps.fail(GENERIC_FAILURE);
  }
}

function toStats(result: AnalysisResult): AnalysisStats {
  return {
    totals: result.totals,
    languages: result.languages,
    directories: result.directories.slice(0, MAX_STORED_DIRECTORIES),
    cycles: result.cycles.slice(0, MAX_STORED_CYCLES),
    cycleCount: result.cycles.length,
    externalPackages: result.externalPackages,
    unanalyzable: result.unanalyzable.slice(0, MAX_STORED_UNANALYZABLE),
    unanalyzableCount: result.unanalyzable.length,
  };
}

function describeDownloadFailure(download: Extract<ArchiveDownload, { ok: false }>): string {
  switch (download.error) {
    case "too_large":
      return "This repository is too large to analyze.";
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
