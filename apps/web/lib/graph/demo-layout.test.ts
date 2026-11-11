import { describe, expect, it } from "vitest";
import { DEMO_NODE, demoLayout } from "./demo-layout";
import type { GraphData } from "./types";

function file(id: number, path: string) {
  return { id, path, language: "TypeScript", lines: 10, incoming: 0, outgoing: 0 };
}

describe("demoLayout", () => {
  it("puts importers to the left of what they import", () => {
    const data: GraphData = {
      files: [file(1, "src/app.ts"), file(2, "src/store.ts"), file(3, "src/util.ts")],
      edges: [
        { source: 1, target: 2, type: "static" },
        { source: 2, target: 3, type: "static" },
      ],
    };
    const { nodes } = demoLayout(data);
    const x = (id: number) => nodes.find((node) => node.id === id)!.x;
    expect(x(1)).toBeLessThan(x(2));
    expect(x(2)).toBeLessThan(x(3));
  });

  it("leaves out files with no imports either way, and counts them", () => {
    const data: GraphData = {
      files: [file(1, "a.ts"), file(2, "b.ts"), file(3, "config.ts")],
      edges: [{ source: 1, target: 2, type: "static" }],
    };
    const layout = demoLayout(data);
    expect(layout.nodes.map((node) => node.id).sort()).toEqual([1, 2]);
    expect(layout.standalone).toBe(1);
  });

  it("keeps one edge per pair of files, the most telling kind", () => {
    const data: GraphData = {
      files: [file(1, "a.ts"), file(2, "b.ts")],
      edges: [
        { source: 1, target: 2, type: "type" },
        { source: 1, target: 2, type: "static" },
      ],
    };
    expect(demoLayout(data).edges).toEqual([{ source: 1, target: 2, type: "static" }]);
  });

  it("survives a cycle", () => {
    const data: GraphData = {
      files: [file(1, "a.ts"), file(2, "b.ts")],
      edges: [
        { source: 1, target: 2, type: "static" },
        { source: 2, target: 1, type: "static" },
      ],
    };
    expect(demoLayout(data).nodes).toHaveLength(2);
  });

  it("sizes the drawing to its columns and rows", () => {
    const data: GraphData = {
      files: [file(1, "a.ts"), file(2, "b.ts"), file(3, "c.ts")],
      edges: [
        { source: 1, target: 3, type: "static" },
        { source: 2, target: 3, type: "static" },
      ],
    };
    const layout = demoLayout(data);
    expect(layout.width).toBe(DEMO_NODE.column + DEMO_NODE.width);
    expect(layout.height).toBe(DEMO_NODE.row + DEMO_NODE.height);
  });
});
