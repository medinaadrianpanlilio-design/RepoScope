import { describeRule, matchesPattern, patternProblem, type ImportRule, type RuleMode } from "@reposcope/engine";
import { z } from "zod";

const MAX_NOTE_LENGTH = 2000;
const MAX_PATH_LENGTH = 500;

const pattern = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = patternProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const notePath = z
  .string()
  .trim()
  .max(MAX_PATH_LENGTH, "That path is too long.")
  .transform((value) => value.replace(/\\/g, "/").replace(/^(\.?\/)+/, "").replace(/\/+$/, ""))
  .nullable()
  .transform((value) => value || null);

const ruleSchema = z
  .strictObject({
    kind: z.literal("import_rule"),
    from: pattern,
    to: pattern,
    mode: z.enum(["must_not", "only"]),
  })
  .refine(({ from, to }) => from !== to, { message: "A rule needs two different folders." });

const noteSchema = z.strictObject({
  kind: z.literal("note"),
  body: z
    .string()
    .trim()
    .min(1, "Write the note first.")
    .max(MAX_NOTE_LENGTH, `Keep notes under ${MAX_NOTE_LENGTH} characters.`),
  path: notePath,
});

export const conventionSchema = z.discriminatedUnion("kind", [ruleSchema, noteSchema]);

export type ConventionInput = z.infer<typeof conventionSchema>;

export type ConventionRow = {
  id: string;
  kind: string;
  rule_from: string | null;
  rule_to: string | null;
  rule_mode: string | null;
  note_body: string | null;
  note_path: string | null;
};

export type RuleConvention = ImportRule & { kind: "import_rule"; text: string };
export type NoteConvention = { id: string; kind: "note"; body: string; path: string | null };
export type Convention = RuleConvention | NoteConvention;

export function toRowFields(input: ConventionInput) {
  return input.kind === "import_rule"
    ? { rule_from: input.from, rule_to: input.to, rule_mode: input.mode }
    : { note_body: input.body, note_path: input.path };
}

export function toConvention(row: ConventionRow): Convention {
  if (row.kind === "note") {
    return { id: row.id, kind: "note", body: row.note_body ?? "", path: row.note_path };
  }
  const rule = {
    id: row.id,
    from: row.rule_from ?? "",
    to: row.rule_to ?? "",
    mode: row.rule_mode as RuleMode,
  };
  return { ...rule, kind: "import_rule", text: describeRule(rule) };
}

export const rulesIn = (conventions: Convention[]) =>
  conventions.filter((item): item is RuleConvention => item.kind === "import_rule");

export const notesIn = (conventions: Convention[]) =>
  conventions.filter((item): item is NoteConvention => item.kind === "note");

/** What an agent should know about one file: notes on it or its folders, and rules it's under. */
export function conventionsForFile(conventions: Convention[], path: string) {
  return {
    notes: notesIn(conventions)
      .filter((note) => note.path && (path === note.path || path.startsWith(`${note.path}/`)))
      .map((note) => note.body),
    rules: rulesIn(conventions)
      .filter((rule) => matchesPattern(rule.from, path))
      .map((rule) => rule.text),
  };
}
