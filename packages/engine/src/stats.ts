import type { AnalysisResult } from "./types.ts";

const MAX_STORED_DIRECTORIES = 50;
const MAX_STORED_CYCLES = 100;
const MAX_STORED_UNANALYZABLE = 100;
const MAX_STORED_OTHER_FILES = 5000;

/** The compact numbers kept with an analysis, whether it ran on a server or on a PC. */
export function summarizeResult(result: AnalysisResult) {
  return {
    totals: result.totals,
    languages: result.languages,
    directories: result.directories.slice(0, MAX_STORED_DIRECTORIES),
    cycles: result.cycles.slice(0, MAX_STORED_CYCLES),
    cycleCount: result.cycles.length,
    otherFiles: result.otherFiles.slice(0, MAX_STORED_OTHER_FILES),
    otherFileCount: result.otherFiles.length,
    externalPackages: result.externalPackages,
    unanalyzable: result.unanalyzable.slice(0, MAX_STORED_UNANALYZABLE),
    unanalyzableCount: result.unanalyzable.length,
  };
}

export type ResultSummary = ReturnType<typeof summarizeResult>;
