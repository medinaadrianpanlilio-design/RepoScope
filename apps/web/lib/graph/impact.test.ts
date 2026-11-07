import { describe, expect, it } from "vitest";
import { changeImpact, impactByNode } from "./impact";
import type { GraphData, GraphFile } from "./types";

const file = (id: number, path: string): GraphFile => ({
  id,
  path,
  language: "TypeScript",
  lines: 1,
  incoming: 0,
  outgoing: 0,
});

const edge = (source: number, target: number) => ({ source, target, type: "static" as const });

// 2 imports 1, 3 imports 2, 4 imports 1 and 3, and 5 is unrelated.
const data: GraphData = {
  files: [file(1, "lib/a.ts"), file(2, "lib/b.ts"), file(3, "app/c.ts"), file(4, "app/d.ts"), file(5, "e.ts")],
  edges: [edge(2, 1), edge(3, 2), edge(4, 1), edge(4, 3)],
};

const summary = (impact: ReturnType<typeof changeImpact>) =>
  impact.map(({ file: f, depth }) => [f.id, depth]);

describe("changeImpact", () => {
  it("lists everything that depends on a file, nearest first", () => {
    expect(summary(changeImpact(data, [1]))).toEqual([
      [4, 1],
      [2, 1],
      [3, 2],
    ]);
  });

  it("follows imports backward, not forward", () => {
    expect(summary(changeImpact(data, [3]))).toEqual([[4, 1]]);
  });

  it("returns nothing for a file nothing depends on", () => {
    expect(changeImpact(data, [5])).toEqual([]);
  });

  it("combines several changed files and leaves them out of the result", () => {
    expect(summary(changeImpact(data, [2, 3]))).toEqual([[4, 1]]);
  });

  it("uses the shortest route to each file", () => {
    expect(changeImpact(data, [1]).find((i) => i.file.id === 4)?.depth).toBe(1);
  });

  it("handles a cycle without looping", () => {
    const loop: GraphData = {
      files: [file(1, "a.ts"), file(2, "b.ts"), file(3, "c.ts")],
      edges: [edge(1, 2), edge(2, 3), edge(3, 1)],
    };

    expect(summary(changeImpact(loop, [1]))).toEqual([
      [3, 1],
      [2, 2],
    ]);
  });

  it("returns nothing for no files", () => {
    expect(changeImpact(data, [])).toEqual([]);
  });
});

describe("impactByNode", () => {
  const impact = changeImpact(data, [1]);

  it("marks files individually when their folders are open", () => {
    expect(impactByNode(impact, new Set(["lib", "app"]))).toEqual(
      new Map([
        ["file:2", 1],
        ["file:3", 1],
        ["file:4", 1],
      ]),
    );
  });

  it("counts affected files inside a closed folder", () => {
    expect(impactByNode(impact, new Set())).toEqual(
      new Map([
        ["folder:lib", 1],
        ["folder:app", 2],
      ]),
    );
  });
});
