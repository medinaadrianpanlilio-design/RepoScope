import {
  analyzeFileSet,
  analyzePrepared,
  buildFileSet,
  prepareSource,
  type InputFile,
} from "@reposcope/engine";
import { describe, expect, it, vi } from "vitest";
import type { BlobFetch, TreeFile, TreeLookup } from "@/lib/github/git-data";
import {
  blobSha,
  decodeSnapshot,
  encodeSnapshot,
  MAX_FETCHED_FILES,
  prepareIncremental,
  snapshotOf,
  type Snapshot,
} from "./snapshot";

const encoder = new TextEncoder();
const A = "a".repeat(40);
const B = "b".repeat(40);

type Files = Record<string, string | Uint8Array>;

const inputsOf = (files: Files): InputFile[] =>
  Object.entries(files).map(([path, content]) => ({
    path,
    bytes: typeof content === "string" ? encoder.encode(content) : content,
  }));

/** A commit on a fake GitHub: its tree lists every file, and blobs answer by hash. */
function github(files: Files, extra: { truncated?: boolean } = {}) {
  const blobs = new Map<string, Uint8Array>();
  const tree: TreeFile[] = inputsOf(files).map(({ path, bytes }) => {
    const sha = blobSha(bytes);
    blobs.set(sha, bytes);
    return { path, sha, size: bytes.length };
  });
  return {
    tree: vi.fn(async (): Promise<TreeLookup> =>
      extra.truncated
        ? { ok: false as const, error: "truncated" as const }
        : { ok: true as const, files: tree, entries: tree.length },
    ),
    blob: vi.fn(async (sha: string): Promise<BlobFetch> => {
      const bytes = blobs.get(sha);
      return bytes ? { ok: true as const, bytes } : { ok: false as const, error: "not_found" as const };
    }),
  };
}

function fullSnapshot(commitSha: string, files: Files): Snapshot {
  const inputs = inputsOf(files);
  const fileSet = buildFileSet(inputs);
  return snapshotOf(commitSha, inputs, fileSet, fileSet.sources.map(prepareSource))!;
}

const before: Files = {
  "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  "packages/ui/package.json": JSON.stringify({ name: "@app/ui", main: "index.ts" }),
  "packages/ui/index.ts": 'export { Button } from "./button";\n',
  "packages/ui/button.tsx": "export const Button = 1;\n",
  "src/a.ts": 'import { b } from "./b";\nimport "@/later";\nimport "@app/ui";\nexport const a = b;\n',
  "src/b.ts": 'import x from "lodash";\nexport const b = 1;\n',
  "src/old-name.ts": 'import { a } from "./a";\nexport const o = a;\n',
  "src/gone.ts": 'export const gone = require(name);\n',
  "src/blob.ts": new Uint8Array([1, 0, 2]),
  "src/vendor.js": `${"x".repeat(6000)}\n`,
  "node_modules/dep/index.js": "module.exports = 1;\n",
  "yarn.lock": "",
  "styles.css": "a{}",
};

const after: Files = {
  ...before,
  // A path alias now points somewhere else, which changes an unchanged file's import.
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./lib/*"] } } }),
  // An import of src/a.ts that was unresolved now finds a file.
  "lib/later.ts": "export const later = 1;\n",
  // Changed, and now in a cycle with a.ts.
  "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
  "src/new-name.ts": before["src/old-name.ts"]!,
  "src/blob.ts": "export const notBinaryAnyMore = 1;\n",
  "src/big.ts": "x".repeat(1024 * 1024 + 1),
};
delete after["src/old-name.ts"];
delete after["src/gone.ts"];

describe("prepareIncremental", () => {
  it("gives exactly what a full analysis of the new commit gives", async () => {
    const source = github(after);
    const incremental = await prepareIncremental(fullSnapshot(A, before), B, source);

    expect(incremental.ok).toBe(true);
    if (!incremental.ok) return;
    const full = analyzeFileSet(buildFileSet(inputsOf(after)));
    expect(analyzePrepared(incremental.prepared)).toEqual(full);
    expect(full.cycles).toEqual([["src/a.ts", "src/b.ts"]]);
  });

  it("fetches only changed files and the config files, and parses only what changed", async () => {
    const source = github(after);
    const incremental = await prepareIncremental(fullSnapshot(A, before), B, source);
    if (!incremental.ok) throw new Error(incremental.reason);

    const fetched = source.blob.mock.calls.map(([sha]) => sha);
    const shaOf = (path: string) => blobSha(inputsOf({ [path]: after[path]! })[0]!.bytes);
    expect(new Set(fetched)).toEqual(
      new Set(
        [
          "package.json",
          "tsconfig.json",
          "packages/ui/package.json",
          "lib/later.ts",
          "src/b.ts",
          "src/new-name.ts",
          "src/blob.ts",
        ].map(shaOf),
      ),
    );
    expect(incremental.parsed).toBe(4);
    expect(incremental.reused).toBe(3);
  });

  it("leaves a snapshot the next run can start from", async () => {
    const first = await prepareIncremental(fullSnapshot(A, before), B, github(after));
    if (!first.ok) throw new Error(first.reason);

    const next: Files = { ...after, "src/a.ts": "export const a = 2;\n" };
    const second = await prepareIncremental(
      decodeSnapshot(encodeSnapshot(first.snapshot))!,
      "c".repeat(40),
      github(next),
    );
    if (!second.ok) throw new Error(second.reason);
    expect(analyzePrepared(second.prepared)).toEqual(analyzeFileSet(buildFileSet(inputsOf(next))));
    expect(second.parsed).toBe(1);
  });

  it.each([
    ["the file list was cut short", github(after, { truncated: true }), /truncated/],
    [
      "too many files changed",
      github({
        ...before,
        ...Object.fromEntries(
          Array.from({ length: MAX_FETCHED_FILES }, (_, i) => [`gen/f${i}.ts`, `export const f = ${i};\n`]),
        ),
      }),
      /too many changed files/,
    ],
    [
      "a .gitattributes changes the archive",
      github({ ...after, ".gitattributes": "docs/ export-ignore\n" }),
      /changes the archive/,
    ],
  ])("runs in full when %s", async (_label, source, reason) => {
    const incremental = await prepareIncremental(fullSnapshot(A, before), B, source);
    expect(incremental).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
  });

  it("runs in full when GitHub answers with bytes that don't match the hash", async () => {
    const source = github(after);
    source.blob.mockResolvedValue({ ok: true, bytes: encoder.encode("something else") });

    expect(await prepareIncremental(fullSnapshot(A, before), B, source)).toMatchObject({
      ok: false,
      reason: "a file didn't match its hash",
    });
  });

  it("runs in full when a file can't be read, or the snapshot is from an older version", async () => {
    const source = github(after);
    source.blob.mockResolvedValue({ ok: false, error: "upstream" });
    expect(await prepareIncremental(fullSnapshot(A, before), B, source)).toMatchObject({ ok: false });

    const old = { ...fullSnapshot(A, before), analysisVersion: "0" };
    expect(await prepareIncremental(old, B, github(after))).toMatchObject({ ok: false });
  });

  it("leaves limits to the full analysis, so they're reported the same way", async () => {
    const empty = await prepareIncremental(fullSnapshot(A, before), B, github({ "README.md": "hi" }));
    expect(empty).toMatchObject({ ok: false, reason: "outside the analysis limits" });
  });
});

describe("snapshotOf", () => {
  it("keeps no snapshot when .gitattributes changes what GitHub's archive holds", () => {
    const files = { ...before, ".gitattributes": "*.ts export-subst\n" };
    const inputs = inputsOf(files);
    const fileSet = buildFileSet(inputs);
    expect(snapshotOf(A, inputs, fileSet, fileSet.sources.map(prepareSource))).toBeNull();
  });

  it("keeps parse results and hashes, never source code", () => {
    const encoded = JSON.stringify(fullSnapshot(A, before));
    expect(encoded).not.toContain("module.exports");
    expect(encoded).not.toContain('"workspaces"');
    expect(encoded).not.toContain("xxxxxxxx");
  });
});

describe("decodeSnapshot", () => {
  it("reads back what it wrote, and refuses anything else", () => {
    const snapshot = fullSnapshot(A, before);
    expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
    expect(decodeSnapshot("not a snapshot")).toBeNull();
    expect(decodeSnapshot(Buffer.from("{}").toString("base64"))).toBeNull();
  });
});
