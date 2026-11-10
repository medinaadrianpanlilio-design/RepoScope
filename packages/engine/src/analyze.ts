import { findCycles } from "./cycles.ts";
import { parseFile } from "./parse.ts";
import { createResolver } from "./resolve.ts";
import type {
  AnalysisResult,
  DependencyEdge,
  DirectoryStat,
  FileMetrics,
  FileSet,
  LanguageStat,
  ParsedFile,
  SkippedFile,
  SourceFile,
  UnresolvedImport,
} from "./types.ts";

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  jsx: "JSX",
};

/** One source file after parsing. Parsing reads only the file itself, so it can be kept and reused. */
export type PreparedSource = {
  path: string;
  size: number;
  lines: number;
  parsed: ParsedFile;
};

/** A file set whose sources are already parsed. */
export type PreparedFileSet = {
  sources: PreparedSource[];
  configs: Map<string, string>;
  allPaths: Set<string>;
  skipped: SkippedFile[];
};

export function prepareSource({ path, content, size }: SourceFile): PreparedSource {
  return { path, size, lines: countLines(content), parsed: parseFile(path, content) };
}

export function analyzeFileSet(fileSet: FileSet): AnalysisResult {
  return analyzePrepared({ ...fileSet, sources: fileSet.sources.map(prepareSource) });
}

/**
 * Everything after parsing: resolving, counting and finding cycles. It runs over the whole set
 * every time, because a change in one file can change what another file's imports point to.
 * Inputs are sorted first, so the result doesn't depend on the order files arrived in.
 */
export function analyzePrepared(prepared: PreparedFileSet): AnalysisResult {
  const sources = [...prepared.sources].sort((a, b) => compare(a.path, b.path));
  const configs = new Map([...prepared.configs].sort(([a], [b]) => compare(a, b)));
  const allPaths = new Set([...prepared.allPaths].sort(compare));

  const resolver = createResolver({
    sourcePaths: new Set(sources.map((file) => file.path)),
    allPaths,
    configs,
  });

  const files = new Map<string, FileMetrics>();
  const edges = new Map<string, DependencyEdge>();
  const unresolved: UnresolvedImport[] = [];
  const unanalyzable: AnalysisResult["unanalyzable"] = [];
  const externalPackages = new Set<string>();

  for (const { path, size, lines, parsed } of sources) {
    files.set(path, {
      path,
      language: languageOf(path),
      size,
      lines,
      incoming: 0,
      outgoing: 0,
      exports: parsed.exports,
      hasSyntaxErrors: parsed.hasSyntaxErrors,
    });

    unanalyzable.push(...parsed.unanalyzable.map((item) => ({ ...item, source: path })));

    for (const { specifier, type, line } of parsed.imports) {
      const resolution = resolver.resolve(path, specifier);

      if (resolution.kind === "internal") {
        const key = `${path}\0${resolution.target}\0${type}\0${specifier}`;
        if (!edges.has(key)) {
          edges.set(key, { source: path, target: resolution.target, type, specifier, line });
        }
      } else if (resolution.kind === "external") {
        externalPackages.add(resolution.packageName);
      } else if (resolution.kind === "unresolved") {
        unresolved.push({ source: path, specifier, line });
      }
    }
  }

  const edgeList = [...edges.values()];
  countConnections(edgeList, files);

  const runtimeNeighbors = new Map<string, string[]>();
  for (const edge of edgeList) {
    if (edge.type === "type") continue;
    const neighbors = runtimeNeighbors.get(edge.source) ?? [];
    neighbors.push(edge.target);
    runtimeNeighbors.set(edge.source, neighbors);
  }

  const fileList = [...files.values()];
  const directories = directoriesOf(allPaths);

  return {
    files: fileList,
    edges: edgeList,
    unresolved,
    unanalyzable,
    externalPackages: [...externalPackages].sort(),
    otherFiles: [...allPaths].filter((path) => !files.has(path)).sort(),
    cycles: findCycles(files.keys(), runtimeNeighbors),
    languages: languageStats(fileList),
    directories: directoryStats(allPaths),
    totals: {
      allFiles: allPaths.size,
      directories: directories.size,
      sourceFiles: fileList.length,
      lines: fileList.reduce((sum, file) => sum + file.lines, 0),
      internalDependencies: edgeList.length,
      unresolvedImports: unresolved.length,
      skippedFiles: prepared.skipped.length,
    },
  };
}

/** Counts each connected file once, however many ways the two files are related. */
function countConnections(edges: DependencyEdge[], files: Map<string, FileMetrics>) {
  const pairs = new Set<string>();
  for (const { source, target } of edges) {
    const key = `${source}\0${target}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    files.get(source)!.outgoing++;
    files.get(target)!.incoming++;
  }
}

function languageOf(path: string): string {
  return LANGUAGES[path.slice(path.lastIndexOf(".") + 1)] ?? "Other";
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = content.endsWith("\n") ? 0 : 1;
  for (let i = content.indexOf("\n"); i !== -1; i = content.indexOf("\n", i + 1)) lines++;
  return lines;
}

function languageStats(files: FileMetrics[]): LanguageStat[] {
  const stats = new Map<string, LanguageStat>();
  for (const { language, lines } of files) {
    const stat = stats.get(language) ?? { language, files: 0, lines: 0 };
    stat.files++;
    stat.lines += lines;
    stats.set(language, stat);
  }
  return [...stats.values()].sort((a, b) => b.lines - a.lines);
}

function directoriesOf(paths: Set<string>): Set<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      directories.add(parts.slice(0, depth).join("/"));
    }
  }
  return directories;
}

function directoryStats(paths: Set<string>): DirectoryStat[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join("/");
      counts.set(directory, (counts.get(directory) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([path, files]) => ({ path, files }))
    .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path));
}

/** Plain code-unit order, the same on every machine and locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
