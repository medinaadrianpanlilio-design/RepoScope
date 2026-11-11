import { describe, expect, it } from "vitest";
import { elkGraph, isLayoutKind, readLayout, type LayoutNode } from "./layouts";

const node = (id: string, path: string): LayoutNode => ({ id, width: 10, height: 5, path });

const nodes = [
  node("file:1", "src/app.ts"),
  node("file:2", "src/lib/db.ts"),
  node("file:3", "index.ts"),
  node("folder:test", "test"),
];
const edges = [
  { id: "a", source: "file:1", target: "file:2" },
  { id: "loop", source: "folder:test", target: "folder:test" },
];

describe("elkGraph", () => {
  it("lays everything out flat for the layered and force layouts", () => {
    for (const kind of ["layered", "force"] as const) {
      const graph = elkGraph(kind, nodes, edges);
      expect(graph.children!.map((child) => child.id)).toEqual(["file:1", "file:2", "file:3", "folder:test"]);
      expect(graph.layoutOptions!["elk.algorithm"]).toBe(kind);
    }
  });

  it("leaves out self-loops, which ELK can't place", () => {
    expect(elkGraph("layered", nodes, edges).edges).toEqual([
      { id: "a", sources: ["file:1"], targets: ["file:2"] },
    ]);
  });

  it("nests nodes in a frame per folder for the directory layout", () => {
    const graph = elkGraph("directory", nodes, edges);
    expect(graph.layoutOptions!["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");

    const ids = (list = graph.children) => list!.map((child) => child.id);
    // A collapsed folder sits beside root files, like a file in its parent.
    expect(ids()).toEqual(["box:src", "file:3", "folder:test"]);
    const src = graph.children![0]!;
    expect(ids(src.children)).toEqual(["file:1", "box:src/lib"]);
    expect(ids(src.children![1]!.children)).toEqual(["file:2"]);
  });
});

describe("readLayout", () => {
  it("turns nested positions into absolute ones and collects the frames", () => {
    const { positions, boxes } = readLayout({
      id: "root",
      children: [
        {
          id: "box:src",
          x: 100,
          y: 50,
          width: 300,
          height: 200,
          children: [
            { id: "file:1", x: 10, y: 20 },
            { id: "box:src/lib", x: 5, y: 60, width: 100, height: 80, children: [{ id: "file:2", x: 1, y: 2 }] },
          ],
        },
        { id: "file:3", x: 0, y: 0 },
      ],
    });

    expect(positions).toEqual({
      "file:1": { x: 110, y: 70 },
      "file:2": { x: 106, y: 112 },
      "file:3": { x: 0, y: 0 },
    });
    expect(boxes).toEqual([
      { id: "box:src", path: "src", x: 100, y: 50, width: 300, height: 200 },
      { id: "box:src/lib", path: "src/lib", x: 105, y: 110, width: 100, height: 80 },
    ]);
  });
});

describe("with ELK itself", () => {
  const inside = (box: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }) =>
    p.x >= box.x && p.y >= box.y && p.x + 10 <= box.x + box.width && p.y + 5 <= box.y + box.height;

  it.each(["layered", "force", "directory"] as const)("places every node with the %s layout", async (kind) => {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const result = readLayout(await new ELK().layout(elkGraph(kind, nodes, edges)));

    expect(Object.keys(result.positions).sort()).toEqual(nodes.map((n) => n.id).sort());
    if (kind !== "directory") return;
    const src = result.boxes.find((box) => box.path === "src")!;
    const lib = result.boxes.find((box) => box.path === "src/lib")!;
    expect(inside(src, result.positions["file:1"]!)).toBe(true);
    expect(inside(lib, result.positions["file:2"]!)).toBe(true);
    expect(inside(src, { x: lib.x, y: lib.y })).toBe(true);
    expect(inside(src, result.positions["file:3"]!)).toBe(false);
  });
});

describe("isLayoutKind", () => {
  it("accepts only known layouts, so a stored choice can't be anything else", () => {
    expect(isLayoutKind("force")).toBe(true);
    expect(isLayoutKind("radial")).toBe(false);
    expect(isLayoutKind(null)).toBe(false);
  });
});
