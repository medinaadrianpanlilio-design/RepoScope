export type RuleMode = "must_not" | "only";

export type ImportRule = { id: string; from: string; to: string; mode: RuleMode };

export type RuleEdge = { source: string; target: string; type?: string };

export type RuleViolation = RuleEdge & { ruleId: string };

const MAX_PATTERN_LENGTH = 200;
const MAX_WILDCARDS = 4;
const ALLOWED_CHARACTERS = /^[\w.@()[\]+~*/-]+$/;

/** Explains what's wrong with a folder pattern, or returns null when it's fine. */
export function patternProblem(pattern: string): string | null {
  if (!pattern) return "Enter a folder or file, such as shared/**.";
  if (pattern.length > MAX_PATTERN_LENGTH) return "That pattern is too long.";
  if (pattern.includes("\\")) return "Use forward slashes, such as src/shared/**.";
  if (!ALLOWED_CHARACTERS.test(pattern)) {
    return "Patterns can only use letters, numbers, slashes and * for wildcards.";
  }
  if (pattern.startsWith("/")) return "Start from the repository root, without a leading slash.";

  const parts = pattern.replace(/\/$/, "").split("/");
  if (parts.some((part) => part === "")) return "That pattern has an empty folder name.";
  if (parts.some((part) => part === "." || part === "..")) {
    return "Patterns can't use . or .. folders.";
  }
  if (parts.some((part) => part.includes("**") && part !== "**")) {
    return "** has to be a whole folder name, such as src/**/api.";
  }
  if ((pattern.match(/\*+/g) ?? []).length > MAX_WILDCARDS) {
    return `Use at most ${MAX_WILDCARDS} wildcards.`;
  }
  return null;
}

function literal(text: string): string {
  return text.replace(/[.+()[\]^$|{}?\\]/g, "\\$&");
}

function toRegExp(pattern: string): RegExp {
  const normalized = pattern.endsWith("/") ? `${pattern}**` : pattern;
  const parts = normalized.split("/");

  const body = parts
    .map((part, index) => {
      const last = index === parts.length - 1;
      if (part === "**") return last ? ".*" : "(?:.*/)?";
      return part.split("*").map(literal).join("[^/]*") + (last ? "" : "/");
    })
    .join("");

  // A plain name covers that file, or everything in that folder.
  return new RegExp(`^${body}${normalized.includes("*") ? "" : "(?:/.*)?"}$`);
}

export function matchesPattern(pattern: string, path: string): boolean {
  return toRegExp(pattern).test(path);
}

export function describeRule({ from, to, mode }: Pick<ImportRule, "from" | "to" | "mode">): string {
  return `${from} ${mode === "must_not" ? "must not import" : "may only import"} ${to}`;
}

/**
 * Finds each import that breaks a rule. Imports that stay inside one side of a rule aren't
 * crossing anything, so they never count.
 */
export function checkImportRules(edges: RuleEdge[], rules: ImportRule[]): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    const from = toRegExp(rule.from);
    const to = toRegExp(rule.to);

    for (const edge of edges) {
      if (edge.source === edge.target || !from.test(edge.source)) continue;

      const broken =
        rule.mode === "must_not"
          ? to.test(edge.target) && !to.test(edge.source)
          : !to.test(edge.target) && !from.test(edge.target);

      if (broken) violations.push({ ...edge, ruleId: rule.id });
    }
  }
  return violations;
}
