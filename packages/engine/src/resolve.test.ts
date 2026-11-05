import { describe, expect, it } from "vitest";
import { createResolver } from "./resolve.ts";

function resolver(paths: string[], configs: Record<string, string> = {}) {
  const sources = new Set(paths.filter((p) => /\.[cm]?[jt]sx?$/.test(p)));
  return createResolver({
    sourcePaths: sources,
    allPaths: new Set([...paths, ...Object.keys(configs)]),
    configs: new Map(Object.entries(configs)),
  });
}

const internal = (target: string) => ({ kind: "internal", target });
const external = (packageName: string) => ({ kind: "external", packageName });
const unresolved = { kind: "unresolved" };

describe("relative imports", () => {
  const r = resolver([
    "src/a.ts",
    "src/b.tsx",
    "src/c.js",
    "src/d/index.ts",
    "src/e.mts",
    "src/f.d.ts",
    "lib/g.ts",
    "src/logo.svg",
    "src/both.ts",
    "src/both/index.ts",
  ]);

  it.each([
    ["./b", "src/b.tsx"],
    ["./b.tsx", "src/b.tsx"],
    ["./c", "src/c.js"],
    ["./d", "src/d/index.ts"],
    ["./d/", "src/d/index.ts"],
    ["./d/index", "src/d/index.ts"],
    ["../lib/g", "lib/g.ts"],
    ["./f", "src/f.d.ts"],
    ["./both", "src/both.ts"],
    [".", null],
  ])("resolves %s", (specifier, target) => {
    expect(r.resolve("src/a.ts", specifier)).toEqual(target ? internal(target) : unresolved);
  });

  it("maps a .js import to the .ts file that compiles to it", () => {
    expect(r.resolve("src/c.js", "./a.js")).toEqual(internal("src/a.ts"));
    expect(r.resolve("src/c.js", "./b.jsx")).toEqual(internal("src/b.tsx"));
    expect(r.resolve("src/c.js", "./e.mjs")).toEqual(internal("src/e.mts"));
  });

  it("maps a .js import to a types-only declaration file", () => {
    const declared = resolver(["a.ts", "api.d.ts"]);
    expect(declared.resolve("a.ts", "./api.js")).toEqual(internal("api.d.ts"));
  });

  it("resolves a directory's parent index", () => {
    const parent = resolver(["src/index.ts", "src/x/a.ts"]);
    expect(parent.resolve("src/x/a.ts", "..")).toEqual(internal("src/index.ts"));
  });

  it("reports existing non-source files separately", () => {
    expect(r.resolve("src/a.ts", "./logo.svg")).toEqual({
      kind: "non_source",
      target: "src/logo.svg",
    });
  });

  it("ignores bundler query strings", () => {
    expect(r.resolve("src/a.ts", "./logo.svg?url")).toEqual({
      kind: "non_source",
      target: "src/logo.svg",
    });
    expect(r.resolve("src/a.ts", "./b?worker")).toEqual(internal("src/b.tsx"));
  });

  it("never guesses at a missing file", () => {
    expect(r.resolve("src/a.ts", "./missing")).toEqual(unresolved);
  });

  it("is case-sensitive", () => {
    expect(r.resolve("src/a.ts", "./B")).toEqual(unresolved);
  });

  it("can't escape the repository root", () => {
    expect(r.resolve("src/a.ts", "../../../etc/passwd")).toEqual(unresolved);
  });
});

describe("package imports", () => {
  const r = resolver(["src/a.ts"]);

  it.each([
    ["react", "react"],
    ["react-dom/client", "react-dom"],
    ["@scope/pkg", "@scope/pkg"],
    ["@scope/pkg/sub/path", "@scope/pkg"],
    ["node:fs", "node:fs"],
    ["https://esm.sh/react", "https://esm.sh/react"],
  ])("treats %s as external", (specifier, name) => {
    expect(r.resolve("src/a.ts", specifier)).toEqual(external(name));
  });

  it.each(["@/lib/a", "~/lib/a", "/abs/path", "#internal"])(
    "calls %s unresolved when no alias defines it",
    (specifier) => {
      expect(r.resolve("src/a.ts", specifier)).toEqual(unresolved);
    },
  );
});

describe("tsconfig paths", () => {
  it("resolves wildcard and exact aliases", () => {
    const r = resolver(["src/a.ts", "src/lib/b.ts", "src/special.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"], special: ["./src/special.ts"] } },
      }),
    });

    expect(r.resolve("src/a.ts", "@/lib/b")).toEqual(internal("src/lib/b.ts"));
    expect(r.resolve("src/a.ts", "special")).toEqual(internal("src/special.ts"));
  });

  it("reads comments and trailing commas", () => {
    const r = resolver(["a.ts", "src/b.ts"], {
      "tsconfig.json": `{
        // aliases
        "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },
      }`,
    });

    expect(r.resolve("a.ts", "@/b")).toEqual(internal("src/b.ts"));
  });

  it("uses baseUrl for paths and bare imports", () => {
    const r = resolver(["src/a.ts", "src/lib/b.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: "./src", paths: { "~/*": ["lib/*"] } },
      }),
    });

    expect(r.resolve("src/a.ts", "~/b")).toEqual(internal("src/lib/b.ts"));
    expect(r.resolve("src/a.ts", "lib/b")).toEqual(internal("src/lib/b.ts"));
  });

  it("prefers a real file under baseUrl but still treats others as packages", () => {
    const r = resolver(["src/a.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
    });

    expect(r.resolve("src/a.ts", "react")).toEqual(external("react"));
  });

  it("tries each path target in order", () => {
    const r = resolver(["a.ts", "second/b.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./first/*", "./second/*"] } },
      }),
    });

    expect(r.resolve("a.ts", "@/b")).toEqual(internal("second/b.ts"));
  });

  it("prefers the longest matching alias", () => {
    const r = resolver(["a.ts", "x/b.ts", "y/b.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./x/*"], "@/deep/*": ["./y/*"] } },
      }),
    });

    expect(r.resolve("a.ts", "@/deep/b")).toEqual(internal("y/b.ts"));
  });

  it("follows extends inside the repository, relative to the defining file", () => {
    const r = resolver(["apps/web/a.ts", "shared/b.ts"], {
      "tsconfig.base.json": JSON.stringify({
        compilerOptions: { paths: { "@shared/*": ["./shared/*"] } },
      }),
      "apps/web/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json" }),
    });

    expect(r.resolve("apps/web/a.ts", "@shared/b")).toEqual(internal("shared/b.ts"));
  });

  it("survives an extends loop and a package extends", () => {
    const r = resolver(["a.ts"], {
      "tsconfig.json": JSON.stringify({ extends: ["./b.json", "@tsconfig/node20/tsconfig.json"] }),
      "b.json": JSON.stringify({ extends: "./tsconfig.json" }),
    });

    expect(r.resolve("a.ts", "./a")).toEqual(internal("a.ts"));
  });

  it("uses the nearest tsconfig in a monorepo", () => {
    const r = resolver(["apps/a/x.ts", "apps/a/src/y.ts", "apps/b/x.ts", "apps/b/lib/y.ts"], {
      "apps/a/tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
      }),
      "apps/b/tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./lib/*"] } },
      }),
    });

    expect(r.resolve("apps/a/x.ts", "@/y")).toEqual(internal("apps/a/src/y.ts"));
    expect(r.resolve("apps/b/x.ts", "@/y")).toEqual(internal("apps/b/lib/y.ts"));
  });

  it("reads jsconfig.json", () => {
    const r = resolver(["a.js", "src/b.js"], {
      "jsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    });

    expect(r.resolve("a.js", "@/b")).toEqual(internal("src/b.js"));
  });

  it("survives a broken config", () => {
    const r = resolver(["a.ts"], { "tsconfig.json": "{{{ not json" });

    expect(r.resolve("a.ts", "./a")).toEqual(internal("a.ts"));
  });

  it("can't reach outside the repository through an alias", () => {
    const r = resolver(["a.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["../../../*"] } },
      }),
    });

    expect(r.resolve("a.ts", "@/etc/passwd")).toEqual(unresolved);
  });
});

describe("package.json imports", () => {
  const r = resolver(["pkg/a.ts", "pkg/src/b.ts", "pkg/src/c/d.ts"], {
    "pkg/package.json": JSON.stringify({
      imports: {
        "#b": "./src/b.ts",
        "#cond": { node: "./src/b.ts", default: "./src/c/d.ts" },
        "#c/*": "./src/c/*.ts",
      },
    }),
  });

  it.each([
    ["#b", "pkg/src/b.ts"],
    ["#cond", "pkg/src/b.ts"],
    ["#c/d", "pkg/src/c/d.ts"],
  ])("resolves %s", (specifier, target) => {
    expect(r.resolve("pkg/a.ts", specifier)).toEqual(internal(target));
  });
});

describe("workspace packages", () => {
  const r = resolver(
    ["apps/web/a.ts", "packages/ui/src/index.ts", "packages/ui/src/button.ts", "packages/api/lib/main.js"],
    {
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/ui/package.json": JSON.stringify({
        name: "@acme/ui",
        exports: { ".": "./src/index.ts", "./button": { import: "./src/button.ts" } },
      }),
      "packages/api/package.json": JSON.stringify({ name: "api", main: "./lib/main.js" }),
    },
  );

  it.each([
    ["@acme/ui", "packages/ui/src/index.ts"],
    ["@acme/ui/button", "packages/ui/src/button.ts"],
    ["api", "packages/api/lib/main.js"],
    ["api/lib/main", "packages/api/lib/main.js"],
  ])("resolves %s to the package in this repository", (specifier, target) => {
    expect(r.resolve("apps/web/a.ts", specifier)).toEqual(internal(target));
  });

  it("calls a missing subpath unresolved rather than external", () => {
    expect(r.resolve("apps/web/a.ts", "@acme/ui/missing")).toEqual(unresolved);
  });
});

describe("proving a workspace package", () => {
  const paths = ["app/a.ts", "app/test/fixtures/lib/index.ts", "libs/ui/index.ts"];
  const fixture = JSON.stringify({ name: "real-lib" });

  it("doesn't mistake a test fixture for an installed package", () => {
    const r = resolver(paths, {
      "app/package.json": JSON.stringify({ dependencies: { "real-lib": "^1.0.0" } }),
      "app/test/fixtures/lib/package.json": fixture,
    });

    expect(r.resolve("app/a.ts", "real-lib")).toEqual(external("real-lib"));
  });

  it("accepts the workspace protocol", () => {
    const r = resolver(paths, {
      "app/package.json": JSON.stringify({ dependencies: { ui: "workspace:*" } }),
      "libs/ui/package.json": JSON.stringify({ name: "ui", main: "./index.ts" }),
    });

    expect(r.resolve("app/a.ts", "ui")).toEqual(internal("libs/ui/index.ts"));
  });

  it("reads pnpm-workspace.yaml", () => {
    const r = resolver(paths, {
      "pnpm-workspace.yaml": "packages:\n  - 'libs/*'\n  - \"!libs/old\"\n",
      "libs/ui/package.json": JSON.stringify({ name: "ui", main: "./index.ts" }),
    });

    expect(r.resolve("app/a.ts", "ui")).toEqual(internal("libs/ui/index.ts"));
  });

  it("refuses to choose between two packages with the same name", () => {
    const r = resolver(["a.ts", "x/ui/index.ts", "y/ui/index.ts"], {
      "package.json": JSON.stringify({ workspaces: ["x/*", "y/*"] }),
      "x/ui/package.json": JSON.stringify({ name: "ui", main: "./index.ts" }),
      "y/ui/package.json": JSON.stringify({ name: "ui", main: "./index.ts" }),
    });

    expect(r.resolve("a.ts", "ui")).toEqual(external("ui"));
  });
});

describe("files that exist but weren't parsed", () => {
  it("doesn't call an import of a skipped file unresolved", () => {
    const r = createResolver({
      sourcePaths: new Set(["a.ts"]),
      allPaths: new Set(["a.ts", "huge.ts", "dir/index.tsx"]),
      configs: new Map(),
    });

    expect(r.resolve("a.ts", "./huge")).toEqual({ kind: "non_source", target: "huge.ts" });
    expect(r.resolve("a.ts", "./dir")).toEqual({ kind: "non_source", target: "dir/index.tsx" });
  });
});
