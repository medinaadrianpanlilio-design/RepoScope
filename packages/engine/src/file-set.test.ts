import { describe, expect, it } from "vitest";
import { buildFileSet } from "./file-set.ts";

const text = (path: string, content = "export const a = 1;\n") => ({
  path,
  bytes: new TextEncoder().encode(content),
});

describe("buildFileSet", () => {
  it("keeps supported source files", () => {
    const set = buildFileSet(
      ["a.ts", "b.tsx", "c.js", "d.jsx", "e.mjs", "f.cjs", "g.mts", "h.cts"].map((p) => text(p)),
    );

    expect(set.sources).toHaveLength(8);
    expect(set.skipped).toEqual([]);
  });

  it("records every path, including files it doesn't parse", () => {
    const set = buildFileSet([text("src/a.ts"), text("logo.svg"), text("styles.css")]);

    expect(set.sources.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect([...set.allPaths].sort()).toEqual(["logo.svg", "src/a.ts", "styles.css"]);
  });

  it.each([
    "node_modules/x/index.js",
    "packages/a/node_modules/x/index.js",
    ".git/hooks/a.js",
    "dist/a.js",
    "build/a.js",
    "coverage/a.js",
    ".next/a.js",
    ".turbo/a.js",
    "vendor/a.js",
  ])("excludes %s", (path) => {
    const set = buildFileSet([text(path)]);

    expect(set.sources).toEqual([]);
    expect(set.skipped).toEqual([{ path, reason: "excluded_directory" }]);
  });

  it("lets exclusions be configured", () => {
    const set = buildFileSet([text("generated/a.ts"), text("dist/a.ts")], {
      excludedDirectories: ["generated"],
    });

    expect(set.sources.map((f) => f.path)).toEqual(["dist/a.ts"]);
  });

  it("skips lock files", () => {
    const set = buildFileSet([text("package-lock.json"), text("pnpm-lock.yaml")]);

    expect(set.skipped.map((s) => s.reason)).toEqual(["lock_file", "lock_file"]);
  });

  it("skips binary content even with a source extension", () => {
    const set = buildFileSet([{ path: "a.ts", bytes: new Uint8Array([0x61, 0x00, 0x62]) }]);

    expect(set.skipped).toEqual([{ path: "a.ts", reason: "binary" }]);
  });

  it("skips minified bundles by name and by shape", () => {
    const set = buildFileSet([
      text("lib/a.min.js"),
      text("lib/b.js", `var a=1;${"x".repeat(6000)}`),
    ]);

    expect(set.skipped.map((s) => s.reason)).toEqual(["minified", "minified"]);
  });

  it("skips oversized files", () => {
    const set = buildFileSet([text("a.ts", "x\n".repeat(20))], { maxFileBytes: 10 });

    expect(set.skipped).toEqual([{ path: "a.ts", reason: "too_large" }]);
  });

  it("reads config files as data", () => {
    const set = buildFileSet([
      text("package.json", "{}"),
      text("apps/web/tsconfig.json", "{}"),
      text("jsconfig.json", "{}"),
      text("tsconfig.base.json", "{}"),
      text("data.json", "{}"),
    ]);

    expect([...set.configs.keys()].sort()).toEqual([
      "apps/web/tsconfig.json",
      "jsconfig.json",
      "package.json",
      "tsconfig.base.json",
    ]);
  });

  it("reports when a repository has too many source files", () => {
    const set = buildFileSet([text("a.ts"), text("b.ts"), text("c.ts")], { maxSourceFiles: 2 });

    expect(set.limitExceeded).toEqual({ kind: "source_files", limit: 2, actual: 3 });
  });

  it("reports when a repository is too large", () => {
    const set = buildFileSet([text("a.ts", "12345"), text("b.ts", "12345")], { maxTotalBytes: 8 });

    expect(set.limitExceeded).toEqual({ kind: "total_bytes", limit: 8, actual: 10 });
  });

  it("normalizes unsafe paths out of the set", () => {
    const set = buildFileSet([text("../evil.ts"), text("/abs.ts"), text("a/../../b.ts")]);

    expect(set.sources).toEqual([]);
    expect([...set.allPaths]).toEqual([]);
  });
});
