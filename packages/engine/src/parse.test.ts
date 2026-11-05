import { describe, expect, it } from "vitest";
import { parseFile } from "./parse.ts";

const imports = (code: string, path = "a.ts") =>
  parseFile(path, code).imports.map(({ specifier, type }) => [specifier, type]);

describe("parseFile imports", () => {
  it.each([
    ['import a from "./a";', "./a", "static"],
    ['import { a } from "./a";', "./a", "static"],
    ['import * as a from "./a";', "./a", "static"],
    ['import "./a";', "./a", "static"],
    ['import a = require("./a");', "./a", "static"],
    ['const a = require("./a");', "./a", "static"],
    ['const a = await import("./a");', "./a", "dynamic"],
    ["const a = import(`./a`);", "./a", "dynamic"],
    ['export { a } from "./a";', "./a", "reexport"],
    ['export * from "./a";', "./a", "reexport"],
    ['export * as a from "./a";', "./a", "reexport"],
    ['import type { A } from "./a";', "./a", "type"],
    ['import { type A, type B } from "./a";', "./a", "type"],
    ['export type { A } from "./a";', "./a", "type"],
    ['let a: import("./a").A;', "./a", "type"],
  ])("reads %s", (code, specifier, type) => {
    expect(imports(code)).toEqual([[specifier, type]]);
  });

  it("treats a mix of type and value imports as static", () => {
    expect(imports('import { type A, b } from "./a";')).toEqual([["./a", "static"]]);
  });

  it("finds imports nested inside functions", () => {
    expect(imports('function f() { return import("./a"); }')).toEqual([["./a", "dynamic"]]);
  });

  it("records the line", () => {
    expect(parseFile("a.ts", '\n\nimport "./a";').imports[0]?.line).toBe(3);
  });

  it("ignores imports in comments and strings", () => {
    expect(imports('// import "./a";\nconst s = \'import "./b"\';')).toEqual([]);
  });

  it("ignores method calls named require", () => {
    expect(imports('loader.require("./a");')).toEqual([]);
  });

  it("parses JSX and TSX", () => {
    expect(imports('import A from "./a";\nexport const B = () => <A />;', "b.tsx")).toEqual([
      ["./a", "static"],
    ]);
    expect(imports('import A from "./a";\nexport const B = () => <A />;', "b.jsx")).toEqual([
      ["./a", "static"],
    ]);
  });
});

describe("parseFile unanalyzable imports", () => {
  it("reports dynamic imports without a literal path", () => {
    const parsed = parseFile("a.ts", "const name = 'x';\nimport(name);\nrequire(`./${name}`);");

    expect(parsed.imports).toEqual([]);
    expect(parsed.unanalyzable).toEqual([
      { expression: "import(name)", line: 2 },
      { expression: "require(`./${name}`)", line: 3 },
    ]);
  });
});

describe("parseFile exports", () => {
  it("lists exported names", () => {
    const parsed = parseFile(
      "a.ts",
      [
        "export const a = 1, b = 2;",
        "export function c() {}",
        "export class D {}",
        "export type E = string;",
        "export interface F {}",
        "export enum G {}",
        "const h = 1;",
        "export { h, h as i };",
        "export default function () {}",
      ].join("\n"),
    );

    expect(parsed.exports).toEqual(["a", "b", "c", "D", "E", "F", "G", "h", "i", "default"]);
  });

  it("lists re-exported names", () => {
    expect(parseFile("a.ts", 'export { a, b as c } from "./x";').exports).toEqual(["a", "c"]);
  });

  it("lists default export expressions", () => {
    expect(parseFile("a.ts", "export default 1;").exports).toEqual(["default"]);
  });
});

describe("parseFile robustness", () => {
  it("survives syntax errors and keeps what it can read", () => {
    const parsed = parseFile("a.ts", 'import "./a";\nconst = = ;\nfunction (');

    expect(parsed.hasSyntaxErrors).toBe(true);
    expect(parsed.imports.map((i) => i.specifier)).toEqual(["./a"]);
  });

  it("reports clean files as clean", () => {
    expect(parseFile("a.ts", "export const a = 1;").hasSyntaxErrors).toBe(false);
  });

  it("survives extremely deep nesting", () => {
    const code = `const a = ${"[".repeat(50_000)}${"]".repeat(50_000)};`;

    expect(() => parseFile("a.ts", code)).not.toThrow();
  });
});
