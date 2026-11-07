import { describe, expect, it } from "vitest";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";
import {
  chooseRepository,
  dependentsOf,
  fileContext,
  findFile,
  impactOf,
  overviewOf,
  reachableBy,
  searchPaths,
} from "./answers";

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

describe("reachableBy", () => {
  const shared = { owner_user_id: null };
  const mine = { owner_user_id: "me" };
  const theirs = { owner_user_id: "them" };

  it("keeps shared repositories and the user's own", () => {
    expect(reachableBy([shared, mine], "me")).toEqual([shared, mine]);
  });

  it("drops a repository someone else owns, even when it was saved", () => {
    expect(reachableBy([shared, theirs], "me")).toEqual([shared]);
  });
});

describe("chooseRepository", () => {
  const publicCopy = { full_name: "me/app", source: "github" };
  const clone = { full_name: "me/app", source: "local" };
  const other = { full_name: "you/app", source: "github" };

  it("matches a full name or a short one, in any case", () => {
    expect(chooseRepository([publicCopy], "ME/APP")).toBe(publicCopy);
    expect(chooseRepository([publicCopy], "app")).toBe(publicCopy);
  });

  it("prefers the synced clone over its public record", () => {
    expect(chooseRepository([publicCopy, clone], "me/app")).toBe(clone);
    expect(chooseRepository([publicCopy, clone], "app")).toBe(clone);
  });

  it("doesn't guess between two different repositories", () => {
    expect(chooseRepository([publicCopy, other], "app")).toBeNull();
  });

  it("lets a full name settle a short name clash", () => {
    expect(chooseRepository([publicCopy, other], "you/app")).toBe(other);
  });

  it("finds nothing for an unknown name", () => {
    expect(chooseRepository([publicCopy], "other")).toBeNull();
  });
});

describe("fileContext", () => {
  it("adds notes and rules only when there are some", () => {
    const app = data.files[1]!;
    expect(fileContext(data, app)).not.toHaveProperty("notes");
    expect(fileContext(data, app)).not.toHaveProperty("rules");
    expect(fileContext(data, app, { notes: ["careful"], rules: [] })).toMatchObject({ notes: ["careful"] });
    expect(fileContext(data, app, { notes: [], rules: ["a must not import b"] })).toMatchObject({
      rules: ["a must not import b"],
    });
  });
});

describe("overviewOf", () => {
  const stats = {
    totals: { sourceFiles: 4, lines: 40, internalDependencies: 3 },
    languages: [{ language: "TypeScript", files: 4 }],
    directories: [{ path: "src", files: 3 }],
    externalPackages: Array.from({ length: 20 }, (_, i) => `pkg-${i}`),
    cycleCount: 1,
  };
  const run = { commitSha: "a".repeat(40), isWorkingCopy: false, completedAt: "2026-11-07T00:00:00Z" };
  const counted: GraphPayload = {
    ...data,
    files: [
      { ...file(1, "src/db/index.ts"), incoming: 2 },
      { ...file(2, "src/app.ts"), incoming: 1, outgoing: 1 },
      { ...file(3, "src/page.ts"), outgoing: 2 },
      { ...file(4, "src/page.test.ts"), outgoing: 1 },
      file(5, "lib/index.ts"),
    ],
  };

  it("says what was analyzed and how fresh it is", () => {
    expect(overviewOf(counted, stats, run).analyzed).toEqual({
      commit: "aaaaaaa",
      workingCopy: false,
      at: run.completedAt,
    });
    expect(overviewOf(counted, stats, { ...run, commitSha: null, isWorkingCopy: true }).analyzed).toMatchObject({
      commit: null,
      workingCopy: true,
    });
  });

  it("ranks the most used files by everything that depends on them", () => {
    expect(overviewOf(counted, stats, run).mostUsed).toEqual([
      { path: "src/db/index.ts", importedBy: 2, usedBy: 2 },
      { path: "src/app.ts", importedBy: 1, usedBy: 1 },
    ]);
  });

  it("finds entry points, leaving out tests and files that import nothing", () => {
    expect(overviewOf(counted, stats, run).entryPoints).toEqual(["src/page.ts"]);
  });

  it("stays small however large the repository is", () => {
    const overview = overviewOf(counted, stats, run);
    expect(overview.externalPackages).toHaveLength(12);
    expect(overview.externalPackageCount).toBe(20);
  });
});

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
