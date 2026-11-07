import { describe, expect, it } from "vitest";
import { checkImportRules, describeRule, matchesPattern, patternProblem } from "./rules.ts";

describe("patternProblem", () => {
  it.each(["shared/**", "shared/", "shared", "src/utils.ts", "src/*/api/**", "**/*.test.ts", "app/[id]/(auth)/**"])(
    "accepts %s",
    (pattern) => {
      expect(patternProblem(pattern)).toBeNull();
    },
  );

  it.each([
    ["", /Enter a folder/],
    ["src\\shared", /forward slashes/],
    ["/src/**", /repository root/],
    ["src//api", /empty folder/],
    ["../secrets", /\. or \.\./],
    ["src/**.ts", /whole folder name/],
    ["src/a b", /only use letters/],
    ["*/*/*/*/*", /at most 4/],
    ["a".repeat(201), /too long/],
  ])("explains what's wrong with %s", (pattern, message) => {
    expect(patternProblem(pattern)).toMatch(message);
  });
});

describe("matchesPattern", () => {
  it.each([
    ["shared/**", "shared/a.ts", true],
    ["shared/**", "shared/deep/a.ts", true],
    ["shared/**", "shared", false],
    ["shared/**", "sharedthings/a.ts", false],
    ["shared/", "shared/a.ts", true],
    ["shared", "shared/a.ts", true],
    ["shared", "shared", true],
    ["shared", "other/shared/a.ts", false],
    ["src/utils.ts", "src/utils.ts", true],
    ["src/utils.ts", "src/utilsXts", false],
    ["src/*/api.ts", "src/users/api.ts", true],
    ["src/*/api.ts", "src/users/deep/api.ts", false],
    ["src/**/api.ts", "src/api.ts", true],
    ["src/**/api.ts", "src/a/b/api.ts", true],
    ["**/*.test.ts", "a.test.ts", true],
    ["**/*.test.ts", "src/a.test.ts", true],
    ["app/[id]/**", "app/[id]/page.tsx", true],
    ["app/[id]/**", "app/i/page.tsx", false],
  ])("%s on %s is %s", (pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected);
  });
});

describe("describeRule", () => {
  it("reads like a sentence", () => {
    expect(describeRule({ from: "a/**", to: "b/**", mode: "must_not" })).toBe("a/** must not import b/**");
    expect(describeRule({ from: "a/**", to: "b/**", mode: "only" })).toBe("a/** may only import b/**");
  });
});

describe("checkImportRules", () => {
  const edges = [
    { source: "shared/a.ts", target: "features/x.ts", type: "static" },
    { source: "shared/a.ts", target: "shared/b.ts", type: "static" },
    { source: "features/x.ts", target: "shared/a.ts", type: "static" },
    { source: "features/x.ts", target: "lib/db.ts", type: "type" },
  ];

  it("finds each import a deny rule forbids", () => {
    const rules = [{ id: "r1", from: "shared/**", to: "features/**", mode: "must_not" as const }];
    expect(checkImportRules(edges, rules)).toEqual([
      { source: "shared/a.ts", target: "features/x.ts", type: "static", ruleId: "r1" },
    ]);
  });

  it("finds each import outside an allow rule, and keeps imports inside the folder legal", () => {
    const rules = [{ id: "r2", from: "features/**", to: "shared/**", mode: "only" as const }];
    expect(checkImportRules(edges, rules)).toEqual([
      { source: "features/x.ts", target: "lib/db.ts", type: "type", ruleId: "r2" },
    ]);

    const inside = [{ source: "features/x.ts", target: "features/y.ts" }];
    expect(checkImportRules(inside, rules)).toEqual([]);
  });

  it("doesn't count imports that stay inside the forbidden folder", () => {
    const rules = [{ id: "r3", from: "src/**", to: "src/features/**", mode: "must_not" as const }];
    const found = checkImportRules(
      [
        { source: "src/features/a.ts", target: "src/features/b.ts" },
        { source: "src/app.ts", target: "src/features/a.ts" },
      ],
      rules,
    );
    expect(found.map((v) => v.source)).toEqual(["src/app.ts"]);
  });

  it("reports nothing when no rule applies", () => {
    expect(checkImportRules(edges, [])).toEqual([]);
    expect(
      checkImportRules(edges, [{ id: "r4", from: "other/**", to: "features/**", mode: "must_not" }]),
    ).toEqual([]);
  });
});
