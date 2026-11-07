import { checkImportRules, describeRule, type ImportRule, type RuleViolation } from "@reposcope/engine";
import { cycleContaining, reach } from "./details";
import { outlierThreshold } from "./insights";
import type { GraphData, GraphFile } from "./types";

export type RiskKind =
  | "heavily_used"
  | "new_cycle"
  | "in_cycle"
  | "would_cycle"
  | "broken_rule"
  | "would_break_rule";

/** A reason to look twice, with its evidence. It isn't proof that anything will break. */
export type RiskWarning = {
  id: string;
  kind: RiskKind;
  title: string;
  evidence: string;
  files: string[];
  totalFiles: number;
};

export type RiskSide = GraphData & { cycles: string[][] };

export type PlannedImport = { from: string; to: string };

const MAX_FILES_LISTED = 25;
const MAX_CHANGED_CHECKED = 200;
const FLOOR_DIRECT = 5;
const FLOOR_REACH = 5;
const REACH_SHARE = 0.2;

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

function warning(fields: Omit<RiskWarning, "files" | "totalFiles">, files: string[]): RiskWarning {
  return { ...fields, files: files.slice(0, MAX_FILES_LISTED), totalFiles: files.length };
}

function directImporters(data: GraphData): Map<number, number> {
  const importers = new Map<number, Set<number>>();
  for (const { source, target } of data.edges) {
    if (source === target) continue;
    const set = importers.get(target) ?? new Set();
    set.add(source);
    importers.set(target, set);
  }
  return new Map([...importers].map(([id, set]) => [id, set.size]));
}

/** What counts as heavily used depends on the repository: its normal range, and its size. */
function usageChecker(data: GraphData) {
  const direct = directImporters(data);
  const directBar = outlierThreshold(
    data.files.map((file) => direct.get(file.id) ?? 0),
    FLOOR_DIRECT,
  );
  const reachBar = Math.max(FLOOR_REACH, Math.ceil(data.files.length * REACH_SHARE));

  return (file: GraphFile) => {
    const importers = direct.get(file.id) ?? 0;
    const usedBy = reach(data, file.id, "importedBy").count;
    const percent = Math.round((usedBy / Math.max(data.files.length, 1)) * 100);
    return {
      heavy: importers >= directBar || usedBy >= reachBar,
      evidence: `${plural(importers, "file")} import it directly, and ${plural(usedBy, "file")} depend on it overall, about ${percent}% of the repository.`,
    };
  };
}

function pathEdges(data: GraphData) {
  const paths = new Map(data.files.map((file) => [file.id, file.path]));
  return data.edges.flatMap(({ source, target, type }) => {
    const from = paths.get(source);
    const to = paths.get(target);
    return from && to ? [{ source: from, target: to, type }] : [];
  });
}

const violationKey = (v: RuleViolation) => `${v.ruleId}|${v.source}|${v.target}`;
const cycleKey = (cycle: string[]) => [...new Set(cycle)].sort().join("|");

function brokenRuleWarnings(rules: ImportRule[], violations: RuleViolation[], previous: Set<string> | null) {
  return rules.flatMap((rule) => {
    const found = violations.filter((v) => v.ruleId === rule.id);
    if (found.length === 0) return [];

    const fresh = previous ? found.filter((v) => !previous.has(violationKey(v))) : [];
    const shown = fresh.length > 0 ? fresh : found;
    const example = shown[0]!;
    const newPart =
      fresh.length === 0
        ? ""
        : fresh.length === found.length
          ? found.length === 1
            ? ", and it's new"
            : ", all of them new"
          : `, ${fresh.length.toLocaleString("en-US")} of them new`;

    return [
      warning(
        {
          id: `rule:${rule.id}`,
          kind: "broken_rule" as const,
          title: `Your rule may be broken: ${describeRule(rule)}`,
          evidence: `${plural(found.length, "import")} ${found.length === 1 ? "breaks" : "break"} this rule${newPart}. For example, ${example.source} imports ${example.target}.`,
        },
        [...new Set(shown.map((v) => v.source))],
      ),
    ];
  });
}

function importsByPath(data: GraphData): Map<string, string> {
  const imports = new Map<string, string[]>();
  for (const { source, target } of pathEdges(data)) {
    imports.set(source, [...(imports.get(source) ?? []), target]);
  }
  return new Map([...imports].map(([path, list]) => [path, [...new Set(list)].sort().join("|")]));
}

/** Source isn't stored, so a change shows up in a file's size, line count or imports. */
function changedFiles(current: GraphData, previous: GraphData): GraphFile[] {
  const before = new Map(previous.files.map((file) => [file.path, file]));
  const importsNow = importsByPath(current);
  const importsBefore = importsByPath(previous);

  return current.files
    .filter((file) => {
      const old = before.get(file.path);
      if (!old) return false;
      return (
        old.lines !== file.lines ||
        (old.size !== undefined && file.size !== undefined && old.size !== file.size) ||
        importsBefore.get(file.path) !== importsNow.get(file.path)
      );
    })
    .sort((a, b) => b.incoming - a.incoming)
    .slice(0, MAX_CHANGED_CHECKED);
}

/** What's new in the latest analysis. Without a previous one, only broken rules can be told. */
export function analysisRisks({
  current,
  previous,
  rules,
}: {
  current: RiskSide;
  previous: RiskSide | null;
  rules: ImportRule[];
}): RiskWarning[] {
  const violations = checkImportRules(pathEdges(current), rules);
  const earlier = previous
    ? new Set(checkImportRules(pathEdges(previous), rules).map(violationKey))
    : null;
  const warnings = brokenRuleWarnings(rules, violations, earlier);
  if (!previous) return warnings;

  const knownCycles = new Set(previous.cycles.map(cycleKey));
  for (const cycle of current.cycles) {
    if (knownCycles.has(cycleKey(cycle))) continue;
    warnings.push(
      warning(
        {
          id: `cycle:${cycleKey(cycle)}`,
          kind: "new_cycle",
          title: "A new import cycle appeared",
          evidence: `${plural(cycle.length, "file")} now depend on each other. A cycle isn't necessarily a bug, but it can make code harder to change.`,
        },
        cycle,
      ),
    );
  }

  const usage = usageChecker(current);
  for (const file of changedFiles(current, previous)) {
    const { heavy, evidence } = usage(file);
    if (!heavy) continue;
    warnings.push(
      warning(
        {
          id: `used:${file.path}`,
          kind: "heavily_used",
          title: `A heavily used file changed: ${file.path}`,
          evidence: `${evidence} A change here could reach those files, though it won't necessarily break them.`,
        },
        [file.path],
      ),
    );
  }

  return warnings;
}

/** The route a runtime import takes between two files, if there is one. */
function importRoute(data: GraphData, from: GraphFile, to: GraphFile): string[] | null {
  const neighbors = new Map<number, number[]>();
  for (const { source, target, type } of data.edges) {
    if (type === "type") continue;
    neighbors.set(source, [...(neighbors.get(source) ?? []), target]);
  }

  const paths = new Map(data.files.map((file) => [file.id, file.path]));
  const cameFrom = new Map<number, number | null>([[from.id, null]]);
  const queue = [from.id];

  for (const id of queue) {
    if (id === to.id) {
      const route: string[] = [];
      for (let step: number | null = id; step !== null; step = cameFrom.get(step) ?? null) {
        route.unshift(paths.get(step) ?? "");
      }
      return route;
    }
    for (const next of neighbors.get(id) ?? []) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, id);
      queue.push(next);
    }
  }
  return null;
}

/** Checks a change before it's made. A planned import can name a file that doesn't exist yet. */
export function plannedRisks({
  data,
  cycles,
  files,
  imports,
  rules,
}: {
  data: GraphData;
  cycles: string[][];
  files: GraphFile[];
  imports: PlannedImport[];
  rules: ImportRule[];
}): RiskWarning[] {
  const warnings: RiskWarning[] = [];
  const usage = usageChecker(data);

  for (const file of files) {
    const { heavy, evidence } = usage(file);
    if (heavy) {
      warnings.push(
        warning(
          {
            id: `used:${file.path}`,
            kind: "heavily_used",
            title: `This file is heavily used: ${file.path}`,
            evidence: `${evidence} Check those callers if its behavior changes.`,
          },
          [file.path],
        ),
      );
    }

    const cycle = cycleContaining(cycles, file.path);
    if (cycle) {
      warnings.push(
        warning(
          {
            id: `in-cycle:${file.path}`,
            kind: "in_cycle",
            title: `This file is in an import cycle: ${file.path}`,
            evidence: `It's part of a cycle of ${plural(cycle.length, "file")}, so a change can travel in both directions.`,
          },
          cycle,
        ),
      );
    }
  }

  const planned = new Set(files.map((file) => file.path));
  const existing = checkImportRules(pathEdges(data), rules).filter((v) => planned.has(v.source));
  warnings.push(...brokenRuleWarnings(rules, existing, null));

  const byPath = new Map(data.files.map((file) => [file.path, file]));
  for (const { from, to } of imports) {
    const source = byPath.get(from);
    const target = byPath.get(to);
    const route = source && target ? importRoute(data, target, source) : null;

    if (route) {
      warnings.push(
        warning(
          {
            id: `would-cycle:${from}>${to}`,
            kind: "would_cycle",
            title: `This import would create a cycle: ${from} to ${to}`,
            evidence: `${to} already reaches ${from}: ${route.join(" -> ")}.`,
          },
          route,
        ),
      );
    }

    for (const rule of rules) {
      if (checkImportRules([{ source: from, target: to }], [rule]).length === 0) continue;
      warnings.push(
        warning(
          {
            id: `would-break:${rule.id}:${from}>${to}`,
            kind: "would_break_rule",
            title: `This import would break your rule: ${describeRule(rule)}`,
            evidence: `${from} would import ${to}.`,
          },
          [from],
        ),
      );
    }
  }

  return warnings;
}
