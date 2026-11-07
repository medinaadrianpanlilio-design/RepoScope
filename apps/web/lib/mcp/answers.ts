import { cycleContaining, fileConnections, reach, unresolvedIn } from "@/lib/graph/details";
import { changeImpact } from "@/lib/graph/impact";
import { searchFiles } from "@/lib/graph/tree";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";

const MAX_LISTED = 40;
const MAX_CANDIDATES = 10;

function clean(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
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

export function fileContext(data: GraphPayload, file: GraphFile) {
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

export function searchPaths(data: GraphPayload, query: string, limit = MAX_LISTED) {
  const matches = searchFiles(data.files, query, data.files.length);
  return { total: matches.length, paths: matches.slice(0, limit).map((file) => file.path) };
}
