import { describe, expect, it } from "vitest";
import { cycleContaining, fileConnections, githubFileUrl } from "./details";
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
