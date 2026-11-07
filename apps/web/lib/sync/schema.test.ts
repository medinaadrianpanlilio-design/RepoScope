import { describe, expect, it } from "vitest";
import { chunkSchema, MAX_FILES_PER_CHUNK, startSchema } from "./schema";

const sha = "a".repeat(40);
const start = { name: "TanawBaha", remote: "owner/repo", commit: sha, branch: "main", dirty: false };

const file = {
  path: "src/a.ts",
  language: "TypeScript",
  size: 10,
  lines: 2,
  incoming: 0,
  outgoing: 1,
  exports: ["a"],
  hasSyntaxErrors: false,
};

const edge = { source: "a.ts", target: "b.ts", type: "static", specifier: "./b", line: 1 };

const stats = {
  totals: {
    allFiles: 2,
    directories: 0,
    sourceFiles: 2,
    lines: 4,
    internalDependencies: 1,
    unresolvedImports: 0,
    skippedFiles: 0,
  },
  languages: [{ language: "TypeScript", files: 2, lines: 4 }],
  directories: [],
  cycles: [],
  cycleCount: 0,
  otherFiles: [],
  otherFileCount: 0,
  externalPackages: [],
  unanalyzable: [],
  unanalyzableCount: 0,
};

describe("startSchema", () => {
  it("accepts a folder with a commit", () => {
    expect(startSchema.safeParse(start).success).toBe(true);
  });

  it("accepts a folder with no git history", () => {
    const parsed = startSchema.safeParse({ ...start, remote: null, commit: null, branch: null, dirty: true });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ["a path in the name", { name: "../other" }],
    ["a bad remote", { remote: "https://evil.example/x" }],
    ["a branch name as commit", { commit: "main" }],
    ["an extra field", { content: "export const a = 1;" }],
  ])("refuses %s", (_label, change) => {
    expect(startSchema.safeParse({ ...start, ...change }).success).toBe(false);
  });
});

describe("chunkSchema", () => {
  it("accepts each kind of chunk", () => {
    expect(chunkSchema.safeParse({ kind: "files", rows: [file] }).success).toBe(true);
    expect(chunkSchema.safeParse({ kind: "edges", rows: [edge] }).success).toBe(true);
    expect(
      chunkSchema.safeParse({
        kind: "unresolved",
        rows: [{ source: "a.ts", specifier: "./x", line: 3 }],
      }).success,
    ).toBe(true);
    expect(
      chunkSchema.safeParse({ kind: "complete", files: 2, edges: 1, unresolved: 0, stats }).success,
    ).toBe(true);
  });

  it.each([
    ["a file carrying its source", { ...file, content: "export const secret = 1;" }],
    ["a file carrying its source under another name", { ...file, source: "x" }],
    ["a very long export name", { ...file, exports: ["x".repeat(5000)] }],
    ["too many exports", { ...file, exports: Array(3000).fill("x") }],
    ["an unsafe path", { ...file, path: "../../etc/passwd" }],
    ["an absolute path", { ...file, path: "/etc/passwd" }],
  ])("refuses %s", (_label, row) => {
    expect(chunkSchema.safeParse({ kind: "files", rows: [row] }).success).toBe(false);
  });

  it("refuses source hidden in an import specifier", () => {
    const parsed = chunkSchema.safeParse({
      kind: "edges",
      rows: [{ ...edge, specifier: "x".repeat(5000) }],
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown relationship", () => {
    expect(chunkSchema.safeParse({ kind: "edges", rows: [{ ...edge, type: "magic" }] }).success).toBe(false);
  });

  it("limits rows per chunk", () => {
    const rows = Array(MAX_FILES_PER_CHUNK + 1).fill(file);

    expect(chunkSchema.safeParse({ kind: "files", rows }).success).toBe(false);
  });

  it("refuses extra fields in the stats", () => {
    const parsed = chunkSchema.safeParse({
      kind: "complete",
      files: 2,
      edges: 1,
      unresolved: 0,
      stats: { ...stats, code: "secret" },
    });

    expect(parsed.success).toBe(false);
  });
});
