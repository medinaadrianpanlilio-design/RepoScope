import type { GraphEdge, GraphFile, UnresolvedImport } from "./types";

export type InsightCategory = "dependencies" | "cycles" | "imports" | "structure";
export type InsightSeverity = "warning" | "notice" | "info";

export type InsightFile = { id: number | null; path: string; detail?: string };

/** An observation drawn from the analysis. It isn't proof that anything is wrong. */
export type Insight = {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  explanation: string;
  nextAction: string;
  files: InsightFile[];
  totalFiles: number;
};

export type InsightInput = {
  files: GraphFile[];
  edges: GraphEdge[];
  cycles: string[][];
  /** Cycles are stored up to a limit, so this can exceed cycles.length. */
  cycleCount: number;
  unresolved: UnresolvedImport[];
};

const MAX_FILES_LISTED = 25;
const MAX_CYCLE_INSIGHTS = 10;
const FLOOR_IMPORTS = 12;
const FLOOR_IMPORTED_BY = 15;
const FLOOR_DIRECTORY_FILES = 30;
const MIN_BOTH_DIRECTIONS = 5;
const BARREL_REEXPORT_SHARE = 0.8;

const SEVERITY_ORDER: Record<InsightSeverity, number> = { warning: 0, notice: 1, info: 2 };

/** Files that are normally reached by a tool or framework, not by an import. */
const LIKELY_ENTRY =
  /(^|\/)(index|main|app|server|cli|page|layout|route|proxy|middleware|error|loading|not-found)\.[^/]+$|\.(config|setup|test|spec|stories|d)\.[^/]+$|\.d\.[cm]?ts$|(^|\/)(__tests__|__mocks__|tests?|e2e|scripts?|bin|examples?|fixtures?|benchmarks?)\//i;

/**
 * Far above the repository's own normal range, using the interquartile range. A busy codebase
 * gets a higher bar than a small one, and the floor stops small numbers being called unusual.
 */
export function outlierThreshold(values: number[], floor: number): number {
  if (values.length === 0) return floor;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
  const q1 = at(0.25);
  const q3 = at(0.75);
  return Math.max(floor, q3 + 3 * (q3 - q1));
}

function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : pluralNoun}`;
}

/** Picks the verb form that agrees with the count. */
function verb(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** A barrel file mostly re-exports others. Importing many files is its whole job. */
function barrelFiles(edges: GraphEdge[]): Set<number> {
  const totals = new Map<number, { all: number; reexports: number }>();
  for (const { source, type } of edges) {
    const total = totals.get(source) ?? { all: 0, reexports: 0 };
    total.all++;
    if (type === "reexport") total.reexports++;
    totals.set(source, total);
  }
  return new Set(
    [...totals]
      .filter(([, { all, reexports }]) => reexports / all >= BARREL_REEXPORT_SHARE)
      .map(([id]) => id),
  );
}

function listed(files: InsightFile[]): Pick<Insight, "files" | "totalFiles"> {
  return { files: files.slice(0, MAX_FILES_LISTED), totalFiles: files.length };
}

function dependencyInsights({ files, edges }: InsightInput): Insight[] {
  const barrels = barrelFiles(edges);
  const importLimit = outlierThreshold(files.map((f) => f.outgoing), FLOOR_IMPORTS);
  const importedByLimit = outlierThreshold(files.map((f) => f.incoming), FLOOR_IMPORTED_BY);

  const high = { imports: [] as GraphFile[], usedBy: [] as GraphFile[], both: [] as GraphFile[] };
  for (const file of files) {
    const importsMany = file.outgoing >= importLimit && !barrels.has(file.id);
    const usedByMany = file.incoming >= importedByLimit;
    if (importsMany && usedByMany && Math.min(file.incoming, file.outgoing) >= MIN_BOTH_DIRECTIONS) {
      high.both.push(file);
    } else if (importsMany) {
      high.imports.push(file);
    } else if (usedByMany) {
      high.usedBy.push(file);
    }
  }

  const insights: Insight[] = [];

  if (high.both.length > 0) {
    insights.push({
      id: "highly-connected",
      category: "dependencies",
      severity: "notice",
      title: "Highly connected files",
      description: `${plural(high.both.length, "file")} ${verb(high.both.length, "both imports many files and is", "both import many files and are")} imported by many.`,
      explanation:
        "A file busy in both directions can be a natural hub, but a change to it can spread widely and changes elsewhere can reach it.",
      nextAction: "Check whether each file has one clear job, or could be split by responsibility.",
      ...listed(
        high.both
          .sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing))
          .map(({ id, path, incoming, outgoing }) => ({
            id,
            path,
            detail: `imports ${outgoing}, imported by ${incoming}`,
          })),
      ),
    });
  }

  if (high.imports.length > 0) {
    insights.push({
      id: "high-imports",
      category: "dependencies",
      severity: "notice",
      title: "Files with unusually many imports",
      description: `${plural(high.imports.length, "file")} ${verb(high.imports.length, "imports", "import")} far more files than is typical for this repository.`,
      explanation:
        "This is often normal for a top-level page or an entry point. Elsewhere it can mean a file has taken on several jobs.",
      nextAction: "Consider separating data fetching or setup from presentation, where that applies.",
      ...listed(
        high.imports
          .sort((a, b) => b.outgoing - a.outgoing)
          .map(({ id, path, outgoing }) => ({ id, path, detail: `imports ${plural(outgoing, "file")}` })),
      ),
    });
  }

  if (high.usedBy.length > 0) {
    insights.push({
      id: "widely-used",
      category: "dependencies",
      severity: "info",
      title: "Widely used files",
      description: `${plural(high.usedBy.length, "file")} ${verb(high.usedBy.length, "is", "are")} imported by far more files than is typical here.`,
      explanation:
        "Shared utilities are expected to look like this. Changes to them can reach a lot of code, so they're worth extra care.",
      nextAction: "Check the change impact before editing these, and keep their tests strong.",
      ...listed(
        high.usedBy
          .sort((a, b) => b.incoming - a.incoming)
          .map(({ id, path, incoming }) => ({ id, path, detail: `imported by ${plural(incoming, "file")}` })),
      ),
    });
  }

  return insights;
}

function cycleInsights({ cycles, cycleCount, files }: InsightInput): Insight[] {
  const idOf = new Map(files.map((file) => [file.path, file.id]));

  const insights = cycles.slice(0, MAX_CYCLE_INSIGHTS).map((cycle, index): Insight => ({
    id: `cycle-${index}`,
    category: "cycles",
    severity: "warning",
    title: cycle.length === 1 ? "A file imports itself" : `Import cycle between ${cycle.length} files`,
    description:
      cycle.length === 1
        ? `${cycle[0]} imports itself.`
        : `These ${cycle.length} files can reach each other by following imports.`,
    explanation:
      "An import cycle isn't necessarily a bug, and type-only imports are left out here. Cycles can still make load order fragile and code harder to change on its own.",
    nextAction: "See whether shared code could move to a file that both sides import.",
    ...listed(cycle.map((path) => ({ id: idOf.get(path) ?? null, path }))),
  }));

  const remaining = cycleCount - insights.length;
  if (remaining > 0) {
    insights.push({
      id: "cycles-more",
      category: "cycles",
      severity: "notice",
      title: "More import cycles",
      description: `${plural(remaining, "more cycle")} ${verb(remaining, "exists", "exist")} beyond those listed here.`,
      explanation: "Only the largest cycles are shown, to keep this list useful.",
      nextAction: "Work through the largest cycles first. Smaller ones often go with them.",
      files: [],
      totalFiles: 0,
    });
  }
  return insights;
}

function unresolvedInsight({ unresolved, files }: InsightInput): Insight[] {
  if (unresolved.length === 0) return [];

  const counts = new Map<number, number>();
  for (const { fileId } of unresolved) counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
  const byId = new Map(files.map((file) => [file.id, file]));

  const affected = [...counts]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([id, count]) => {
      const file = byId.get(id);
      return file ? [{ id, path: file.path, detail: plural(count, "unresolved import") }] : [];
    });

  return [
    {
      id: "unresolved",
      category: "imports",
      severity: "notice",
      title: "Unresolved imports",
      description: `${plural(unresolved.length, "import")} in ${plural(affected.length, "file")} couldn't be matched to a file.`,
      explanation:
        "These may be files generated at build time, or a setup RepoScope doesn't understand yet. The dependency map is missing these connections, so it may be incomplete here.",
      nextAction: "Open a file to see each import. Check whether the target should exist in the repository.",
      ...listed(affected),
    },
  ];
}

function directoryInsight({ files }: InsightInput): Insight[] {
  const counts = new Map<string, number>();
  for (const { path } of files) {
    const slash = path.lastIndexOf("/");
    if (slash !== -1) {
      const directory = path.slice(0, slash);
      counts.set(directory, (counts.get(directory) ?? 0) + 1);
    }
  }

  // A folder can only be unusual compared with others.
  if (counts.size < 2) return [];

  const limit = outlierThreshold([...counts.values()], FLOOR_DIRECTORY_FILES);
  const large = [...counts]
    .filter(([, count]) => count > limit)
    .sort((a, b) => b[1] - a[1])
    .map(([path, count]) => ({ id: null, path, detail: plural(count, "file") }));

  if (large.length === 0) return [];

  return [
    {
      id: "large-directory",
      category: "structure",
      severity: "info",
      title: "Large directories",
      description: `${plural(large.length, "directory", "directories")} directly ${verb(large.length, "holds", "hold")} far more source files than is typical here.`,
      explanation:
        "This is fine for collections of similar files, such as locales or icons. Otherwise a very full folder can be hard to find your way around.",
      nextAction: "If the files fall into groups, consider subfolders. If they're all alike, leave them.",
      ...listed(large),
    },
  ];
}

function isolatedInsight({ files }: InsightInput): Insight[] {
  const isolated = files.filter(
    (file) => file.incoming === 0 && file.outgoing === 0 && !LIKELY_ENTRY.test(file.path),
  );
  if (isolated.length === 0) return [];

  return [
    {
      id: "isolated",
      category: "structure",
      severity: "info",
      title: "Isolated files",
      description: `${plural(isolated.length, "file")} ${verb(isolated.length, "neither imports nor is", "neither import nor are")} imported by other files in this repository.`,
      explanation:
        "They may be unused, or they may be loaded in a way static analysis can't see, such as by a framework, a tool or a dynamic path. This doesn't prove they're unused.",
      nextAction: "Search for how each file is used before removing anything.",
      ...listed(isolated.map(({ id, path }) => ({ id, path }))),
    },
  ];
}

export function generateInsights(input: InsightInput): Insight[] {
  return [
    ...cycleInsights(input),
    ...dependencyInsights(input),
    ...unresolvedInsight(input),
    ...directoryInsight(input),
    ...isolatedInsight(input),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
