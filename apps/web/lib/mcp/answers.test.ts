import { describe, expect, it } from "vitest";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";
import { dependentsOf, fileContext, findFile, impactOf, searchPaths } from "./answers";

const file = (id: number, path: string): GraphFile => ({
  id,
  path,
  language: "TypeScript",
  lines: 10,
  incoming: 0,
  outgoing: 0,
});

const edge = (source: number, target: number, type: "static" | "type" = "static") => ({
  source,
  target,
  type,
});

const data: GraphPayload = {
  files: [file(1, "src/db/index.ts"), file(2, "src/app.ts"), file(3, "src/page.ts"), file(4, "lib/index.ts")],
  edges: [edge(2, 1), edge(3, 2), edge(3, 1, "type")],
  cycles: [["src/app.ts", "src/page.ts"]],
  unresolved: [{ fileId: 2, specifier: "./gone", line: 4 }],
  otherFiles: [],
  otherFileCount: 0,
};

describe("findFile", () => {
  it("matches an exact path", () => {
    expect(findFile(data, "src/app.ts")).toMatchObject({ file: { id: 2 } });
  });

  it("matches the end of a path when that's unique", () => {
    expect(findFile(data, "db/index.ts")).toMatchObject({ file: { id: 1 } });
  });

  it("accepts Windows separators and a leading ./", () => {
    expect(findFile(data, ".\\src\\app.ts")).toMatchObject({ file: { id: 2 } });
  });

  it("lists the choices when a name is ambiguous", () => {
    expect(findFile(data, "index.ts")).toEqual({
      file: null,
      candidates: ["lib/index.ts", "src/db/index.ts"],
    });
  });

  it("finds nothing for an unknown file", () => {
    expect(findFile(data, "nope.ts")).toEqual({ file: null, candidates: [] });
  });
});

describe("fileContext", () => {
  it("gives an agent what it needs before editing", () => {
    expect(fileContext(data, data.files[1]!)).toEqual({
      path: "src/app.ts",
      language: "TypeScript",
      lines: 10,
      imports: ["src/db/index.ts"],
      importedBy: ["src/page.ts"],
      usedByCount: 1,
      dependsOnCount: 1,
      cycle: ["src/page.ts"],
      unresolvedImports: [{ specifier: "./gone", line: 4 }],
    });
  });
});

describe("dependentsOf", () => {
  it("lists direct importers with their relationship", () => {
    expect(dependentsOf(data, data.files[0]!, 10)).toEqual({
      total: 2,
      files: [
        { path: "src/app.ts", types: ["static"] },
        { path: "src/page.ts", types: ["type"] },
      ],
    });
  });

  it("limits long lists and keeps the true total", () => {
    expect(dependentsOf(data, data.files[0]!, 1)).toMatchObject({ total: 2, files: [{}] });
  });
});

describe("impactOf", () => {
  it("reports affected files, nearest first", () => {
    expect(impactOf(data, [data.files[0]!], 10)).toEqual({
      total: 2,
      maxDepth: 1,
      files: [
        { path: "src/app.ts", depth: 1 },
        { path: "src/page.ts", depth: 1 },
      ],
    });
  });
});

describe("searchPaths", () => {
  it("finds paths and limits the results", () => {
    expect(searchPaths(data, "index", 1)).toEqual({ total: 2, paths: ["lib/index.ts"] });
  });
});
