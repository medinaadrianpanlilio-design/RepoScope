import { describe, expect, it } from "vitest";
import { cycleContaining, fileConnections, githubFileUrl, reach, unresolvedIn } from "./details";
import type { GraphData, GraphFile } from "./types";

const file = (id: number, path: string): GraphFile => ({
  id,
  path,
  language: "TypeScript",
  lines: 1,
  incoming: 0,
  outgoing: 0,
});

const data: GraphData = {
  files: [file(1, "b.ts"), file(2, "a.ts"), file(3, "c.ts")],
  edges: [
    { source: 1, target: 2, type: "static" },
    { source: 1, target: 2, type: "type" },
    { source: 1, target: 3, type: "dynamic" },
    { source: 3, target: 1, type: "reexport" },
    { source: 2, target: 2, type: "static" },
  ],
};

describe("fileConnections", () => {
  it("lists what a file imports, sorted by path, with every relationship", () => {
    expect(fileConnections(data, 1).imports).toEqual([
      { file: data.files[1], types: ["static", "type"] },
      { file: data.files[2], types: ["dynamic"] },
    ]);
  });

  it("lists what imports a file", () => {
    expect(fileConnections(data, 1).importedBy).toEqual([
      { file: data.files[2], types: ["reexport"] },
    ]);
  });

  it("keeps a file that imports itself out of its own lists", () => {
    const connections = fileConnections(data, 2);

    expect(connections.imports).toEqual([]);
    expect(connections.importedBy.map((c) => c.file.id)).toEqual([1]);
  });

  it("skips edges to files that aren't in the data", () => {
    const broken = { ...data, edges: [{ source: 1, target: 99, type: "static" as const }] };

    expect(fileConnections(broken, 1).imports).toEqual([]);
  });
});

describe("cycleContaining", () => {
  const cycles = [
    ["a.ts", "b.ts"],
    ["x.ts", "y.ts", "z.ts"],
  ];

  it("finds a file's cycle", () => {
    expect(cycleContaining(cycles, "y.ts")).toEqual(["x.ts", "y.ts", "z.ts"]);
  });

  it("returns null for a file in no cycle", () => {
    expect(cycleContaining(cycles, "other.ts")).toBeNull();
  });
});

describe("githubFileUrl", () => {
  it("links to the analyzed commit and encodes the path", () => {
    expect(githubFileUrl("https://github.com/o/r", "abc", "app/[id]/a b.ts")).toBe(
      "https://github.com/o/r/blob/abc/app/%5Bid%5D/a%20b.ts",
    );
  });
});

describe("reach", () => {
  const edge = (source: number, target: number) => ({ source, target, type: "static" as const });
  const graph = (...edges: ReturnType<typeof edge>[]): GraphData => ({ files: [], edges });

  it("follows a chain and measures its depth", () => {
    const chain = graph(edge(1, 2), edge(2, 3), edge(3, 4));

    expect(reach(chain, 1, "imports")).toEqual({ count: 3, depth: 3 });
    expect(reach(chain, 4, "importedBy")).toEqual({ count: 3, depth: 3 });
  });

  it("reports nothing for a file with no connections that way", () => {
    expect(reach(graph(edge(1, 2)), 2, "imports")).toEqual({ count: 0, depth: 0 });
  });

  it("counts a shared dependency once and uses the shortest route", () => {
    const diamond = graph(edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 4), edge(1, 4));

    expect(reach(diamond, 1, "imports")).toEqual({ count: 3, depth: 1 });
  });

  it("stops at a cycle and doesn't count the starting file", () => {
    const loop = graph(edge(1, 2), edge(2, 3), edge(3, 1));

    expect(reach(loop, 1, "imports")).toEqual({ count: 2, depth: 2 });
  });

  it("ignores a file importing itself", () => {
    expect(reach(graph(edge(1, 1)), 1, "imports")).toEqual({ count: 0, depth: 0 });
  });
});

describe("unresolvedIn", () => {
  it("lists one file's unresolved imports by line", () => {
    const unresolved = [
      { fileId: 1, specifier: "./b", line: 9 },
      { fileId: 2, specifier: "./x", line: 1 },
      { fileId: 1, specifier: "./a", line: 2 },
    ];

    expect(unresolvedIn(unresolved, 1).map((u) => u.specifier)).toEqual(["./a", "./b"]);
  });
});
