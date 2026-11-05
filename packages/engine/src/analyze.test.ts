import { describe, expect, it } from "vitest";
import { analyzeFileSet } from "./analyze.ts";
import { findCycles } from "./cycles.ts";
import { buildFileSet } from "./file-set.ts";

function analyze(files: Record<string, string>) {
  const encoder = new TextEncoder();
  return analyzeFileSet(
    buildFileSet(
      Object.entries(files).map(([path, content]) => ({ path, bytes: encoder.encode(content) })),
    ),
  );
}

describe("analyzeFileSet", () => {
  const result = analyze({
    "package.json": "{}",
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "src/index.ts": [
      'import { b } from "./b";',
      'import type { T } from "./types";',
      'export * from "@/c";',
      'import react from "react";',
      'import "./missing";',
      'import "./style.css";',
      'import("./lazy");',
      "import(dynamicName);",
      "",
    ].join("\n"),
    "src/b.ts": 'import { c } from "./c";\nexport const b = c;\n',
    "src/c.ts": "export const c = 1;\n",
    "src/types.ts": "export type T = string;\n",
    "src/lazy.tsx": "export default 1;\n",
    "src/style.css": "a {}\n",
    "README.md": "# hi\n",
  });

  const edge = (source: string, target: string) =>
    result.edges.find((e) => e.source === source && e.target === target);

  it("keeps each edge's relationship type and original specifier", () => {
    expect(edge("src/index.ts", "src/b.ts")).toMatchObject({ type: "static", specifier: "./b" });
    expect(edge("src/index.ts", "src/types.ts")).toMatchObject({ type: "type" });
    expect(edge("src/index.ts", "src/c.ts")).toMatchObject({ type: "reexport", specifier: "@/c" });
    expect(edge("src/index.ts", "src/lazy.tsx")).toMatchObject({ type: "dynamic" });
  });

  it("reports unresolved and unanalyzable imports separately", () => {
    expect(result.unresolved).toEqual([{ source: "src/index.ts", specifier: "./missing", line: 5 }]);
    expect(result.unanalyzable).toEqual([
      { source: "src/index.ts", expression: "import(dynamicName)", line: 8 },
    ]);
  });

  it("doesn't call a CSS import unresolved or make it an edge", () => {
    expect(result.unresolved.map((u) => u.specifier)).not.toContain("./style.css");
    expect(result.edges.map((e) => e.target)).not.toContain("src/style.css");
  });

  it("lists external packages", () => {
    expect(result.externalPackages).toEqual(["react"]);
  });

  it("counts connections per file", () => {
    const file = (path: string) => result.files.find((f) => f.path === path)!;

    expect(file("src/index.ts")).toMatchObject({ incoming: 0, outgoing: 4 });
    expect(file("src/c.ts")).toMatchObject({ incoming: 2, outgoing: 0, lines: 1 });
  });

  it("totals what it found", () => {
    expect(result.totals).toMatchObject({
      sourceFiles: 5,
      internalDependencies: 5,
      unresolvedImports: 1,
      directories: 1,
    });
    expect(result.totals.allFiles).toBe(9);
  });

  it("reports language and directory statistics", () => {
    expect(result.languages.map((l) => l.language)).toEqual(["TypeScript", "TSX"]);
    expect(result.directories).toEqual([{ path: "src", files: 6 }]);
  });

  it("merges duplicate imports of the same file", () => {
    const duplicate = analyze({
      "a.ts": 'import { x } from "./b";\nimport { y } from "./b";\n',
      "b.ts": "export const x = 1, y = 2;\n",
    });

    expect(duplicate.edges).toHaveLength(1);
  });
});

describe("cycles", () => {
  it("finds runtime cycles", () => {
    const { cycles } = analyze({
      "a.ts": 'import "./b";',
      "b.ts": 'import "./c";',
      "c.ts": 'import "./a";',
      "d.ts": 'import "./a";',
    });

    expect(cycles).toEqual([["a.ts", "b.ts", "c.ts"]]);
  });

  it("ignores cycles made only of type imports, which disappear at runtime", () => {
    const { cycles } = analyze({
      "a.ts": 'import type { B } from "./b";\nexport type A = B;',
      "b.ts": 'import type { A } from "./a";\nexport type B = A;',
    });

    expect(cycles).toEqual([]);
  });

  it("finds a file that imports itself", () => {
    expect(analyze({ "a.ts": 'import "./a";' }).cycles).toEqual([["a.ts"]]);
  });

  it("finds separate cycles, largest first", () => {
    const adjacency = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["x", ["y"]],
      ["y", ["z"]],
      ["z", ["x"]],
    ]);

    expect(findCycles(adjacency.keys(), adjacency)).toEqual([
      ["x", "y", "z"],
      ["a", "b"],
    ]);
  });

  it("handles a very long chain without overflowing the stack", () => {
    const size = 200_000;
    const adjacency = new Map<string, string[]>();
    for (let i = 0; i < size; i++) adjacency.set(`n${i}`, [`n${(i + 1) % size}`]);

    expect(findCycles(adjacency.keys(), adjacency)[0]).toHaveLength(size);
  });
});
