import { describe, expect, it } from "vitest";
import { generateInsights, outlierThreshold, type InsightInput } from "./insights";
import type { GraphFile } from "./types";

const file = (id: number, path: string, incoming = 1, outgoing = 1, lines = 50): GraphFile => ({
  id,
  path,
  language: "TypeScript",
  lines,
  incoming,
  outgoing,
});

const quiet = Array.from({ length: 30 }, (_, i) => file(i + 1, `src/f${i}.ts`));

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return { files: quiet, edges: [], cycles: [], cycleCount: 0, unresolved: [], ...overrides };
}

const find = (insights: ReturnType<typeof generateInsights>, id: string) =>
  insights.find((insight) => insight.id === id);

describe("outlierThreshold", () => {
  it("adapts to the repository", () => {
    const small = Array.from({ length: 20 }, () => 1);
    const busy = Array.from({ length: 20 }, (_, i) => 10 + i);

    expect(outlierThreshold(small, 10)).toBe(10);
    expect(outlierThreshold(busy, 10)).toBeGreaterThan(40);
  });

  it("handles an empty list", () => {
    expect(outlierThreshold([], 10)).toBe(10);
  });
});

describe("generateInsights", () => {
  it("finds nothing in a quiet repository", () => {
    expect(generateInsights(input())).toEqual([]);
  });

  it("flags a file that imports unusually many others", () => {
    const insights = generateInsights(input({ files: [...quiet, file(99, "src/page.tsx", 1, 30)] }));
    const insight = find(insights, "high-imports");

    expect(insight?.files).toEqual([{ id: 99, path: "src/page.tsx", detail: "imports 30 files" }]);
  });

  it("doesn't flag a barrel file, whose job is re-exporting", () => {
    const edges = Array.from({ length: 30 }, (_, i) => ({
      source: 99,
      target: i + 1,
      type: "reexport" as const,
    }));
    const files = [...quiet, file(99, "src/index.ts", 1, 30)];

    expect(find(generateInsights(input({ files, edges })), "high-imports")).toBeUndefined();
  });

  it("uses grammar that agrees with the count", () => {
    const one = generateInsights(input({ files: [...quiet, file(99, "src/util.ts", 40, 0)] }));
    const two = generateInsights(
      input({ files: [...quiet, file(98, "src/a.ts", 40, 0), file(99, "src/b.ts", 40, 0)] }),
    );

    expect(find(one, "widely-used")?.description).toMatch(/^1 file is imported/);
    expect(find(two, "widely-used")?.description).toMatch(/^2 files are imported/);
  });

  it("uses a threshold relative to the repository", () => {
    const busy = Array.from({ length: 30 }, (_, i) => file(i + 1, `src/f${i}.ts`, 1, 20 + (i % 10)));

    expect(find(generateInsights(input({ files: busy })), "high-imports")).toBeUndefined();
  });

  it("flags a file many others depend on", () => {
    const insights = generateInsights(input({ files: [...quiet, file(99, "src/util.ts", 40, 0)] }));

    expect(find(insights, "widely-used")?.files[0]).toMatchObject({ detail: "imported by 40 files" });
  });

  it("flags a file busy in both directions, and only there", () => {
    const insights = generateInsights(input({ files: [...quiet, file(99, "src/hub.ts", 30, 30)] }));

    expect(find(insights, "highly-connected")?.files[0]?.path).toBe("src/hub.ts");
    expect(find(insights, "widely-used")).toBeUndefined();
    expect(find(insights, "high-imports")).toBeUndefined();
  });

  it("reports each cycle, largest first, in cautious language", () => {
    const insights = generateInsights(
      input({
        cycleCount: 2,
        cycles: [
          ["src/f1.ts", "src/f2.ts", "src/f3.ts"],
          ["src/f4.ts", "src/f5.ts"],
        ],
      }),
    );
    const cycles = insights.filter((insight) => insight.category === "cycles");

    expect(cycles).toHaveLength(2);
    expect(cycles[0]?.files).toHaveLength(3);
    expect(cycles[0]?.explanation).toMatch(/isn't necessarily a bug/i);
  });

  it("says when more cycles exist than are listed", () => {
    const insights = generateInsights(
      input({ cycleCount: 150, cycles: [["src/f1.ts", "src/f2.ts"]] }),
    );

    expect(find(insights, "cycles-more")?.description).toContain("149");
  });

  it("reports unresolved imports per file", () => {
    const insights = generateInsights(
      input({
        unresolved: [
          { fileId: 1, specifier: "./a", line: 1 },
          { fileId: 1, specifier: "./b", line: 2 },
          { fileId: 2, specifier: "./c", line: 1 },
        ],
      }),
    );

    expect(find(insights, "unresolved")?.files).toEqual([
      { id: 1, path: "src/f0.ts", detail: "2 unresolved imports" },
      { id: 2, path: "src/f1.ts", detail: "1 unresolved import" },
    ]);
  });

  it("flags a directory with unusually many files directly inside", () => {
    const many = Array.from({ length: 45 }, (_, i) => file(100 + i, `src/big/f${i}.ts`));
    const insight = find(generateInsights(input({ files: [...quiet, ...many] })), "large-directory");

    expect(insight?.files[0]).toMatchObject({ path: "src/big", detail: "45 files" });
  });

  it("flags isolated files, leaving out likely entry points and tests", () => {
    const insights = generateInsights(
      input({
        files: [
          ...quiet,
          file(90, "src/orphan.ts", 0, 0),
          file(91, "src/index.ts", 0, 0),
          file(92, "src/main.tsx", 0, 0),
          file(93, "vite.config.ts", 0, 0),
          file(94, "src/a.test.ts", 0, 0),
          file(95, "src/__tests__/b.ts", 0, 0),
          file(96, "src/types.d.ts", 0, 0),
          file(97, "app/page.tsx", 0, 0),
          file(98, "scripts/seed.ts", 0, 0),
        ],
      }),
    );

    expect(find(insights, "isolated")?.files.map((f) => f.path)).toEqual(["src/orphan.ts"]);
  });

  it("limits long file lists and keeps the true total", () => {
    const orphans = Array.from({ length: 60 }, (_, i) => file(200 + i, `src/o${i}.ts`, 0, 0));
    const insight = find(generateInsights(input({ files: [...quiet, ...orphans] })), "isolated");

    expect(insight?.files).toHaveLength(25);
    expect(insight?.totalFiles).toBe(60);
  });

  it("gives every insight what the spec requires, with no scores", () => {
    const insights = generateInsights(
      input({
        files: [...quiet, file(99, "src/hub.ts", 30, 30), file(98, "src/orphan.ts", 0, 0)],
        cycleCount: 1,
        cycles: [["src/f1.ts", "src/f2.ts"]],
        unresolved: [{ fileId: 1, specifier: "./x", line: 1 }],
      }),
    );

    expect(insights.length).toBeGreaterThanOrEqual(4);
    for (const insight of insights) {
      expect(insight.title).toBeTruthy();
      expect(insight.description).toBeTruthy();
      expect(insight.explanation).toBeTruthy();
      expect(insight.nextAction).toBeTruthy();
      expect(["info", "notice", "warning"]).toContain(insight.severity);
      expect(insight).not.toHaveProperty("score");
    }
  });

  it("puts the most important insights first", () => {
    const insights = generateInsights(
      input({
        files: [...quiet, file(98, "src/orphan.ts", 0, 0)],
        cycleCount: 1,
        cycles: [["src/f1.ts", "src/f2.ts"]],
      }),
    );

    expect(insights[0]?.severity).toBe("warning");
    expect(insights.at(-1)?.severity).toBe("info");
  });
});
