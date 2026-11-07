import { describe, expect, it } from "vitest";
import { analysisRisks, plannedRisks, type RiskSide } from "./risks";
import type { GraphFile } from "./types";

const file = (id: number, path: string, over: Partial<GraphFile> = {}): GraphFile => ({
  id,
  path,
  language: "TypeScript",
  lines: 10,
  incoming: 0,
  outgoing: 0,
  size: 100,
  ...over,
});
const edge = (source: number, target: number, type: "static" | "type" = "static") => ({ source, target, type });

/** One hub imported by eight files, in a repository of twenty. */
function hubRepository(hub: Partial<GraphFile> = {}): RiskSide {
  const callers = Array.from({ length: 8 }, (_, i) => file(i + 2, `src/caller${i}.ts`));
  const others = Array.from({ length: 11 }, (_, i) => file(i + 20, `src/other${i}.ts`));
  return {
    files: [file(1, "src/hub.ts", { incoming: 8, ...hub }), ...callers, ...others],
    edges: callers.map((caller) => edge(caller.id, 1)),
    cycles: [],
  };
}

const denyRule = { id: "r1", from: "shared/**", to: "features/**", mode: "must_not" as const };

describe("analysisRisks", () => {
  const layered = (extra: ReturnType<typeof edge>[] = []): RiskSide => ({
    files: [file(1, "shared/a.ts"), file(2, "features/x.ts"), file(3, "features/y.ts")],
    edges: [edge(2, 1), ...extra],
    cycles: [],
  });

  it("finds nothing when nothing changed", () => {
    const side = hubRepository();
    expect(analysisRisks({ current: side, previous: side, rules: [] })).toEqual([]);
  });

  it("warns when a heavily used file changed, and names the evidence", () => {
    const [risk] = analysisRisks({
      current: hubRepository({ lines: 40 }),
      previous: hubRepository(),
      rules: [],
    });
    expect(risk).toMatchObject({ kind: "heavily_used", files: ["src/hub.ts"] });
    expect(risk!.evidence).toContain("8 files import it directly");
    expect(risk!.evidence).toContain("40%");
    expect(risk!.evidence).toContain("won't necessarily break");
  });

  it("notices a change of size alone", () => {
    const risks = analysisRisks({
      current: hubRepository({ size: 101 }),
      previous: hubRepository(),
      rules: [],
    });
    expect(risks.map((r) => r.kind)).toEqual(["heavily_used"]);
  });

  it("ignores changes to files that aren't heavily used", () => {
    const current = hubRepository();
    current.files = current.files.map((f) => (f.path === "src/other0.ts" ? { ...f, lines: 99 } : f));
    expect(analysisRisks({ current, previous: hubRepository(), rules: [] })).toEqual([]);
  });

  it("expects more of a file in a repository where many files are busy", () => {
    const busy = (lines: number): RiskSide => {
      const quiet = hubRepository({ lines });
      const targets = Array.from({ length: 30 }, (_, i) => file(i + 100, `lib/target${i}.ts`));
      const callers = Array.from({ length: 60 }, (_, i) => file(i + 200, `lib/caller${i}.ts`));
      const edges = targets.flatMap((target, t) =>
        Array.from({ length: 10 }, (_, k) => edge(callers[(t * 2 + k) % 60]!.id, target.id)),
      );
      return {
        ...quiet,
        files: [...quiet.files, ...targets, ...callers],
        edges: [...quiet.edges, ...edges],
      };
    };

    // Eight importers stands out among twenty quiet files, but not beside thirty files with ten.
    expect(analysisRisks({ current: hubRepository({ lines: 50 }), previous: hubRepository(), rules: [] })).toHaveLength(1);
    expect(analysisRisks({ current: busy(50), previous: busy(10), rules: [] })).toEqual([]);
  });

  it("reports only cycles that weren't there before, in any order", () => {
    const before = { ...layered(), cycles: [["a.ts", "b.ts"]] };
    const after = { ...layered(), cycles: [["b.ts", "a.ts"], ["c.ts", "d.ts"]] };
    const risks = analysisRisks({ current: after, previous: before, rules: [] });
    expect(risks.map((r) => r.files)).toEqual([["c.ts", "d.ts"]]);
    expect(risks[0]!.kind).toBe("new_cycle");
  });

  it("names a broken rule and says what's new", () => {
    const risks = analysisRisks({
      current: layered([edge(1, 2), edge(1, 3)]),
      previous: layered([edge(1, 2)]),
      rules: [denyRule],
    });
    expect(risks).toHaveLength(1);
    expect(risks[0]!.title).toContain("shared/** must not import features/**");
    expect(risks[0]!.evidence).toContain("2 imports break this rule, 1 of them new");
    expect(risks[0]!.evidence).toContain("shared/a.ts imports features/y.ts");
  });

  it("reads properly for a single new import", () => {
    const [risk] = analysisRisks({ current: layered([edge(1, 2)]), previous: layered(), rules: [denyRule] });
    expect(risk!.evidence).toContain("1 import breaks this rule, and it's new");
  });

  it("still reports broken rules on a first analysis, but no comparisons", () => {
    const current = { ...layered([edge(1, 2)]), cycles: [["a.ts", "b.ts"]] };
    const risks = analysisRisks({ current, previous: null, rules: [denyRule] });
    expect(risks.map((r) => r.kind)).toEqual(["broken_rule"]);
  });
});

describe("plannedRisks", () => {
  const side = hubRepository();
  const hub = side.files[0]!;
  const caller = side.files[1]!;

  it("warns about a heavily used file", () => {
    const risks = plannedRisks({ data: side, cycles: [], files: [hub], imports: [], rules: [] });
    expect(risks.map((r) => r.kind)).toEqual(["heavily_used"]);
  });

  it("stays quiet about an ordinary file", () => {
    expect(plannedRisks({ data: side, cycles: [], files: [caller], imports: [], rules: [] })).toEqual([]);
  });

  it("warns about a file already in a cycle", () => {
    const risks = plannedRisks({
      data: side,
      cycles: [["src/caller0.ts", "src/other0.ts"]],
      files: [caller],
      imports: [],
      rules: [],
    });
    expect(risks.map((r) => r.kind)).toEqual(["in_cycle"]);
  });

  it("warns when a new import would close a loop, and shows the route", () => {
    const risks = plannedRisks({
      data: side,
      cycles: [],
      files: [],
      imports: [{ from: "src/hub.ts", to: "src/caller0.ts" }],
      rules: [],
    });
    expect(risks[0]).toMatchObject({ kind: "would_cycle" });
    expect(risks[0]!.evidence).toContain("src/caller0.ts -> src/hub.ts");
  });

  it("doesn't count type-only imports as a route for a cycle", () => {
    const data = { files: [file(1, "a.ts"), file(2, "b.ts")], edges: [edge(2, 1, "type")], cycles: [] };
    const risks = plannedRisks({ data, cycles: [], files: [], imports: [{ from: "a.ts", to: "b.ts" }], rules: [] });
    expect(risks).toEqual([]);
  });

  it("checks a planned import against rules, even to a file that doesn't exist yet", () => {
    const risks = plannedRisks({
      data: side,
      cycles: [],
      files: [],
      imports: [{ from: "shared/new.ts", to: "features/new.ts" }],
      rules: [denyRule],
    });
    expect(risks.map((r) => r.kind)).toEqual(["would_break_rule"]);
  });

  it("reports a rule the planned file already breaks", () => {
    const data = { files: [file(1, "shared/a.ts"), file(2, "features/x.ts")], edges: [edge(1, 2)], cycles: [] };
    const risks = plannedRisks({ data, cycles: [], files: [data.files[0]!], imports: [], rules: [denyRule] });
    expect(risks.map((r) => r.kind)).toEqual(["broken_rule"]);
  });
});
