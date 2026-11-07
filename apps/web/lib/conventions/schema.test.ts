import { describe, expect, it } from "vitest";
import { conventionSchema, conventionsForFile, toConvention, toRowFields, type Convention } from "./schema";

const rule = { kind: "import_rule", from: "shared/**", to: "features/**", mode: "must_not" };
const note = { kind: "note", body: "Payments go through the queue.", path: null };

const messageOf = (input: unknown) => {
  const parsed = conventionSchema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("conventionSchema", () => {
  it("accepts a rule and a note", () => {
    expect(conventionSchema.safeParse(rule).success).toBe(true);
    expect(conventionSchema.safeParse(note).success).toBe(true);
  });

  it("explains an invalid pattern", () => {
    expect(messageOf({ ...rule, from: "src\\shared" })).toMatch(/forward slashes/);
    expect(messageOf({ ...rule, to: "" })).toMatch(/Enter a folder/);
  });

  it("refuses a rule between a folder and itself", () => {
    expect(messageOf({ ...rule, to: "shared/**" })).toMatch(/two different folders/);
  });

  it("refuses an empty note and an oversized one", () => {
    expect(messageOf({ ...note, body: "   " })).toMatch(/Write the note/);
    expect(messageOf({ ...note, body: "x".repeat(2001) })).toMatch(/under 2000/);
  });

  it("refuses unknown fields", () => {
    expect(conventionSchema.safeParse({ ...note, user_id: "someone" }).success).toBe(false);
    expect(conventionSchema.safeParse({ ...rule, repository_id: "other" }).success).toBe(false);
  });

  it.each([
    ["./src/lib/", "src/lib"],
    ["src\\lib\\db.ts", "src/lib/db.ts"],
    ["/src", "src"],
    ["", null],
    [null, null],
  ])("cleans the note path %s", (path, expected) => {
    expect(conventionSchema.parse({ ...note, path })).toMatchObject({ path: expected });
  });
});

describe("rows", () => {
  it("round-trips a rule", () => {
    const fields = toRowFields(conventionSchema.parse(rule));
    const row = { id: "1", kind: "import_rule", note_body: null, note_path: null, ...fields };
    expect(toConvention(row as never)).toEqual({
      id: "1",
      kind: "import_rule",
      from: "shared/**",
      to: "features/**",
      mode: "must_not",
      text: "shared/** must not import features/**",
    });
  });

  it("round-trips a note", () => {
    const fields = toRowFields(conventionSchema.parse({ ...note, path: "src" }));
    const row = { id: "2", kind: "note", rule_from: null, rule_to: null, rule_mode: null, ...fields };
    expect(toConvention(row as never)).toEqual({ id: "2", kind: "note", body: note.body, path: "src" });
  });
});

describe("conventionsForFile", () => {
  const conventions: Convention[] = [
    { id: "1", kind: "note", body: "whole repo", path: null },
    { id: "2", kind: "note", body: "on the folder", path: "src/pay" },
    { id: "3", kind: "note", body: "on the file", path: "src/pay/card.ts" },
    { id: "4", kind: "note", body: "similar name", path: "src/payroll" },
    { id: "5", kind: "import_rule", from: "src/pay/**", to: "ui/**", mode: "must_not", text: "src/pay/** must not import ui/**" },
    { id: "6", kind: "import_rule", from: "ui/**", to: "src/**", mode: "must_not", text: "other" },
  ];

  it("gives a file its own notes and rules, and leaves repository notes to get_conventions", () => {
    expect(conventionsForFile(conventions, "src/pay/card.ts")).toEqual({
      notes: ["on the folder", "on the file"],
      rules: ["src/pay/** must not import ui/**"],
    });
  });

  it("doesn't match a folder by the start of its name", () => {
    expect(conventionsForFile(conventions, "src/payroll/a.ts").notes).toEqual(["similar name"]);
  });
});
