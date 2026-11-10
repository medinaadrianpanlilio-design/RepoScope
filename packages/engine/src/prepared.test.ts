import { describe, expect, it } from "vitest";
import { analyzeFileSet, analyzePrepared, prepareSource } from "./analyze.ts";
import { buildFileSet, placePath, readContent } from "./file-set.ts";
import type { InputFile } from "./types.ts";

const encoder = new TextEncoder();
const inputs: InputFile[] = Object.entries({
  "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
  "packages/ui/package.json": JSON.stringify({ name: "@app/ui", main: "index.ts" }),
  "packages/ui/index.ts": 'export { Button } from "./button";\n',
  "packages/ui/button.tsx": 'import "./button.css";\nexport const Button = 1;\n',
  "packages/ui/button.css": ".b{}",
  "src/a.ts": 'import { Button } from "@app/ui";\nimport { b } from "./b";\nexport const a = b;\n',
  "src/b.ts": 'import { a } from "./a";\nimport x from "lodash";\nexport const b = a;\n',
  "src/gone.ts": 'import "./nowhere";\nrequire(name);\n',
  "dist/out.js": "1",
  "yarn.lock": "",
  "vendor.min.js": "x",
  "logo.png": "\u0000",
}).map(([path, content]) => ({ path, bytes: encoder.encode(content) }));

describe("analyzePrepared", () => {
  it("gives the same result as a full analysis, whatever order the files arrive in", () => {
    const full = analyzeFileSet(buildFileSet(inputs));
    const shuffled = buildFileSet([...inputs].reverse());
    const prepared = analyzePrepared({
      ...shuffled,
      sources: shuffled.sources.map(prepareSource).reverse(),
    });

    expect(prepared).toEqual(full);
    expect(full.cycles).toEqual([["src/a.ts", "src/b.ts"]]);
  });
});

describe("placePath and readContent", () => {
  it("make the same decisions as buildFileSet", () => {
    const set = buildFileSet(inputs);
    const sources: string[] = [];
    const skipped: string[] = [];
    const configs: string[] = [];

    for (const { path, bytes } of inputs) {
      const place = placePath(path, bytes.length);
      if (place.kind === "excluded") skipped.push(`${path}:excluded_directory`);
      else if (place.kind === "skipped") skipped.push(`${path}:${place.reason}`);
      else if (place.kind === "config") configs.push(path);
      else if (place.kind === "content") {
        const read = readContent(path, bytes);
        if (read.kind === "skipped") skipped.push(`${path}:${read.reason}`);
        else sources.push(path);
      }
    }

    expect(sources.sort()).toEqual(set.sources.map((file) => file.path).sort());
    expect(configs.sort()).toEqual([...set.configs.keys()].sort());
    expect(skipped.sort()).toEqual(set.skipped.map((file) => `${file.path}:${file.reason}`).sort());
  });

  it("decides size limits from the size alone", () => {
    expect(placePath("big.ts", 2 * 1024 * 1024)).toEqual({ kind: "skipped", reason: "too_large" });
    expect(placePath("tsconfig.json", 2 * 1024 * 1024)).toEqual({ kind: "other" });
    expect(placePath("../escape.ts", 1)).toEqual({ kind: "unsafe" });
  });
});
