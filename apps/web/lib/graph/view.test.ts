import { describe, expect, it } from "vitest";
import type { GraphData, GraphFile } from "./types";
import { connectedTo, defaultExpanded, foldersOf, GROUP_THRESHOLD, toGraphView } from "./view";

function file(id: number, path: string): GraphFile {
  return { id, path, language: "TypeScript", lines: 1, incoming: 0, outgoing: 0 };
}

const data: GraphData = {
  files: [
    file(1, "src/a/one.ts"),
    file(2, "src/a/two.ts"),
    file(3, "src/b/three.ts"),
    file(4, "lib/four.ts"),
    file(5, "root.ts"),
  ],
  edges: [
    { source: 1, target: 2, type: "static" },
    { source: 1, target: 3, type: "static" },
    { source: 2, target: 3, type: "static" },
    { source: 2, target: 3, type: "type" },
    { source: 3, target: 4, type: "dynamic" },
    { source: 5, target: 1, type: "reexport" },
  ],
};

const everything = new Set(["src", "src/a", "src/b", "lib"]);
const ids = (view: ReturnType<typeof toGraphView>) => view.nodes.map((n) => n.id).sort();

describe("toGraphView", () => {
  it("shows every file when all folders are open", () => {
    const view = toGraphView(data, everything);

    expect(ids(view)).toEqual(["file:1", "file:2", "file:3", "file:4", "file:5"]);
    expect(view.edges).toHaveLength(6);
  });

  it("shows a closed folder as one node with its file count", () => {
    const view = toGraphView(data, new Set());

    expect(view.nodes.find((n) => n.id === "folder:src")).toMatchObject({
      kind: "folder",
      name: "src",
      fileCount: 3,
    });
    expect(ids(view)).toEqual(["file:5", "folder:lib", "folder:src"]);
  });

  it("opens one level at a time", () => {
    expect(ids(toGraphView(data, new Set(["src"])))).toEqual([
      "file:5",
      "folder:lib",
      "folder:src/a",
      "folder:src/b",
    ]);
  });

  it("merges connections between closed folders and counts them", () => {
    const { edges } = toGraphView(data, new Set(["src"]));

    expect(edges.find((e) => e.source === "folder:src/a" && e.type === "static")).toMatchObject({
      target: "folder:src/b",
      count: 2,
    });
  });

  it("keeps relationship types separate when merging", () => {
    const { edges } = toGraphView(data, new Set(["src"]));

    expect(edges.filter((e) => e.source === "folder:src/a").map((e) => e.type).sort()).toEqual([
      "static",
      "type",
    ]);
  });

  it("drops connections inside a closed folder", () => {
    const { edges } = toGraphView(data, new Set(["src"]));

    expect(edges.some((e) => e.source === e.target)).toBe(false);
  });

  it("keeps a file's own import of itself", () => {
    const selfImport: GraphData = {
      files: [file(1, "a.ts")],
      edges: [{ source: 1, target: 1, type: "static" }],
    };

    expect(toGraphView(selfImport, new Set()).edges).toHaveLength(1);
  });

  it("ignores an edge to a file that isn't in the data", () => {
    const broken: GraphData = {
      files: [file(1, "a.ts")],
      edges: [{ source: 1, target: 99, type: "static" }],
    };

    expect(toGraphView(broken, new Set()).edges).toEqual([]);
  });
});

describe("defaultExpanded", () => {
  it("opens everything for a small repository", () => {
    expect(defaultExpanded(data.files)).toEqual(everything);
  });

  it("starts a big repository closed", () => {
    const files = Array.from({ length: GROUP_THRESHOLD + 1 }, (_, i) =>
      file(i, `${i % 2 ? "a" : "b"}/f${i}.ts`),
    );

    expect(defaultExpanded(files)).toEqual(new Set());
  });

  it("opens through a single top folder, which would otherwise show one box", () => {
    const files = Array.from({ length: GROUP_THRESHOLD + 1 }, (_, i) =>
      file(i, `src/app/${i % 2 ? "x" : "y"}/f${i}.ts`),
    );

    expect(defaultExpanded(files)).toEqual(new Set(["src", "src/app"]));
  });
});

describe("foldersOf", () => {
  it("lists a file's folders from the top down", () => {
    expect(foldersOf("src/a/one.ts")).toEqual(["src", "src/a"]);
    expect(foldersOf("root.ts")).toEqual([]);
  });
});

describe("connectedTo", () => {
  const { edges } = toGraphView(data, everything);

  it("separates what a node uses from what uses it", () => {
    expect(connectedTo("file:3", edges)).toEqual({
      incoming: new Set(["file:1", "file:2"]),
      outgoing: new Set(["file:4"]),
    });
  });

  it("returns nothing for an unconnected node", () => {
    expect(connectedTo("file:99", edges)).toEqual({ incoming: new Set(), outgoing: new Set() });
  });
});
