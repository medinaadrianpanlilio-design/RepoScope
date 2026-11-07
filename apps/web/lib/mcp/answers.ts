import { cycleContaining, fileConnections, reach, unresolvedIn } from "@/lib/graph/details";
import { changeImpact } from "@/lib/graph/impact";
import { searchFiles } from "@/lib/graph/tree";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";

const MAX_LISTED = 40;
const MAX_CANDIDATES = 10;
const MAX_OVERVIEW_ITEMS = 8;
const MAX_OVERVIEW_PACKAGES = 12;
const MOST_USED_CANDIDATES = 40;

/** Files nothing imports on purpose, so they say little about how the code is entered. */
const NOT_AN_ENTRY =
  /\.(test|spec|stories|config|setup|d)\.[^/]+$|(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures?|examples?|benchmarks?|scripts?)\//i;

function clean(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * A saved row alone proves nothing: a shared Repository can become someone's private one after
 * others saved it. Every other read depends on this list, so it checks ownership itself.
 */
export function reachableBy<T extends { owner_user_id: string | null }>(
  repositories: T[],
  userId: string,
): T[] {
  return repositories.filter(({ owner_user_id }) => owner_user_id === null || owner_user_id === userId);
}

/**
 * A synced clone and its public record share a name. The clone is the code being worked on,
 * and may have uncommitted changes, so it wins.
 */
function oneOf<T extends { source: string }>(matches: T[]): T | null {
  if (matches.length === 1) return matches[0]!;
  const local = matches.filter((repository) => repository.source === "local");
  return local.length === 1 ? local[0]! : null;
}

export function chooseRepository<T extends { full_name: string; source: string }>(
  repositories: T[],
  name: string,
): T | null {
  const wanted = name.trim().toLowerCase();
  const exact = repositories.filter((r) => r.full_name.toLowerCase() === wanted);
  if (exact.length > 0) return oneOf(exact);
  return oneOf(repositories.filter((r) => r.full_name.toLowerCase().endsWith(`/${wanted}`)));
}

/** Agents often give a partial path, so a unique ending counts as a match. */
export function findFile(data: GraphPayload, path: string) {
  const wanted = clean(path);
  const exact = data.files.find((file) => file.path === wanted);
  if (exact) return { file: exact, candidates: [] };

  const matches = data.files.filter((file) => file.path.endsWith(`/${wanted}`));
  if (matches.length === 1) return { file: matches[0]!, candidates: [] };

  return {
    file: null,
    candidates: matches.map((file) => file.path).sort().slice(0, MAX_CANDIDATES),
  };
}

type FileConventions = { notes: string[]; rules: string[] };

export function fileContext(
  data: GraphPayload,
  file: GraphFile,
  conventions: FileConventions = { notes: [], rules: [] },
) {
  const { imports, importedBy } = fileConnections(data, file.id);
  const cycle = cycleContaining(data.cycles, file.path);

  return {
    path: file.path,
    language: file.language,
    lines: file.lines,
    imports: imports.slice(0, MAX_LISTED).map((c) => c.file.path),
    importedBy: importedBy.slice(0, MAX_LISTED).map((c) => c.file.path),
    usedByCount: reach(data, file.id, "importedBy").count,
    dependsOnCount: reach(data, file.id, "imports").count,
    cycle: cycle ? cycle.filter((path) => path !== file.path).slice(0, MAX_LISTED) : [],
    unresolvedImports: unresolvedIn(data.unresolved, file.id).map(({ specifier, line }) => ({
      specifier,
      line,
    })),
    // Left out when empty, as most files have none and every field costs the agent tokens.
    ...(conventions.notes.length > 0 && { notes: conventions.notes }),
    ...(conventions.rules.length > 0 && { rules: conventions.rules }),
  };
}

export function dependentsOf(data: GraphPayload, file: GraphFile, limit = MAX_LISTED) {
  const { importedBy } = fileConnections(data, file.id);
  return {
    total: importedBy.length,
    files: importedBy.slice(0, limit).map((c) => ({ path: c.file.path, types: c.types })),
  };
}

export function impactOf(data: GraphPayload, files: GraphFile[], limit = MAX_LISTED) {
  const impacted = changeImpact(data, files.map((file) => file.id));
  return {
    total: impacted.length,
    maxDepth: impacted.at(-1)?.depth ?? 0,
    files: impacted.slice(0, limit).map(({ file, depth }) => ({ path: file.path, depth })),
  };
}

type OverviewStats = {
  totals: { sourceFiles: number; lines: number; internalDependencies: number };
  languages: { language: string; files: number }[];
  directories: { path: string; files: number }[];
  externalPackages: string[];
  cycleCount: number;
};

type OverviewRun = { commitSha: string | null; isWorkingCopy: boolean; completedAt: string | null };

/** The first thing to read about a repository, kept small so it's cheaper than exploring it. */
export function overviewOf(data: GraphPayload, stats: OverviewStats, run: OverviewRun) {
  const mostUsed = [...data.files]
    .sort((a, b) => b.incoming - a.incoming)
    .slice(0, MOST_USED_CANDIDATES)
    .filter((file) => file.incoming > 0)
    .map((file) => ({
      path: file.path,
      importedBy: file.incoming,
      usedBy: reach(data, file.id, "importedBy").count,
    }))
    .sort((a, b) => b.usedBy - a.usedBy || a.path.localeCompare(b.path))
    .slice(0, MAX_OVERVIEW_ITEMS);

  const entryPoints = data.files
    .filter((file) => file.incoming === 0 && file.outgoing > 0 && !NOT_AN_ENTRY.test(file.path))
    .sort((a, b) => b.outgoing - a.outgoing || a.path.localeCompare(b.path))
    .slice(0, MAX_OVERVIEW_ITEMS)
    .map((file) => file.path);

  return {
    analyzed: {
      commit: run.commitSha?.slice(0, 7) ?? null,
      workingCopy: run.isWorkingCopy,
      at: run.completedAt,
    },
    totals: {
      files: stats.totals.sourceFiles,
      lines: stats.totals.lines,
      dependencies: stats.totals.internalDependencies,
      cycles: stats.cycleCount,
      unresolvedImports: data.unresolved.length,
    },
    languages: stats.languages.slice(0, MAX_OVERVIEW_ITEMS).map(({ language, files }) => ({ language, files })),
    folders: stats.directories.slice(0, MAX_OVERVIEW_ITEMS).map(({ path, files }) => ({ path, files })),
    mostUsed,
    entryPoints,
    externalPackages: stats.externalPackages.slice(0, MAX_OVERVIEW_PACKAGES),
    externalPackageCount: stats.externalPackages.length,
  };
}

export function searchPaths(data: GraphPayload, query: string, limit = MAX_LISTED) {
  const matches = searchFiles(data.files, query, data.files.length);
  return { total: matches.length, paths: matches.slice(0, limit).map((file) => file.path) };
}
