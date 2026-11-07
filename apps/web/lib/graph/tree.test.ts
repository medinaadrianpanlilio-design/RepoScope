import { describe, expect, it } from "vitest";
import { buildTree, extensionOf, extensionsOf, searchFiles, type TreeFolder } from "./tree";
import type { GraphFile } from "./types";

const file = (id: number, path: string): GraphFile => ({
  id,
  path,
  language: "TypeScript",
  lines: 1,
  incoming: 0,
  outgoing: 0,
});

const files = [
  file(1, "src/z.ts"),
  file(2, "src/a/one.tsx"),
  file(3, "src/a/two.ts"),
  file(4, "root.js"),
  file(5, "lib/x.d.ts"),
];

const folder = (tree: TreeFolder, name: string) =>
  tree.folders.find((child) => child.name === name)!;

describe("buildTree", () => {
  const tree = buildTree(files);

  it("nests files under their folders", () => {
    expect(folder(folder(tree, "src"), "a").files.map((f) => f.path)).toEqual([
      "src/a/one.tsx",
      "src/a/two.ts",
    ]);
  });

  it("keeps each folder's full path", () => {
    expect(folder(folder(tree, "src"), "a").path).toBe("src/a");
  });

  it("puts root files at the top level", () => {
    expect(tree.files.map((f) => f.path)).toEqual(["root.js"]);
  });

  it("sorts folders and files by name", () => {
    expect(tree.folders.map((f) => f.name)).toEqual(["lib", "src"]);
  });

  it("counts every file below a folder", () => {
    expect(folder(tree, "src").fileCount).toBe(3);
    expect(tree.fileCount).toBe(5);
  });

  it("builds an empty tree", () => {
    expect(buildTree([])).toMatchObject({ folders: [], files: [], fileCount: 0 });
  });
});

describe("extensions", () => {
  it("reads the last extension", () => {
    expect(extensionOf("a/b.tsx")).toBe(".tsx");
    expect(extensionOf("a.d.ts")).toBe(".ts");
    expect(extensionOf("Makefile")).toBe("");
  });

  it("lists extensions with counts, most common first", () => {
    expect(extensionsOf(files)).toEqual([
      { extension: ".ts", count: 3 },
      { extension: ".js", count: 1 },
      { extension: ".tsx", count: 1 },
    ]);
  });
});

describe("searchFiles", () => {
  it("matches any part of a path, ignoring case", () => {
    expect(searchFiles(files, "SRC/A").map((f) => f.id)).toEqual([2, 3]);
  });

  it("ranks a match on the file name above a match on its folder", () => {
    const ranked = [file(1, "button/index.ts"), file(2, "src/button.ts")];

    expect(searchFiles(ranked, "button").map((f) => f.id)).toEqual([2, 1]);
  });

  it("returns nothing for a blank search", () => {
    expect(searchFiles(files, "   ")).toEqual([]);
  });

  it("limits long result lists", () => {
    const many = Array.from({ length: 300 }, (_, i) => file(i, `f${i}.ts`));

    expect(searchFiles(many, "f", 50)).toHaveLength(50);
  });
});
