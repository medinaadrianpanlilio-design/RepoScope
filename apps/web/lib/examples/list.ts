/**
 * Public repositories anyone can open without importing anything. The daily job keeps each one
 * imported and analyzed, and the cleanup never removes them. Small and well known, so the graph
 * is readable at a glance.
 */
export const EXAMPLES = [
  { owner: "vercel", name: "ms", about: "A tiny library: one file and its tests." },
  { owner: "sindresorhus", name: "ky", about: "An HTTP client: a small, tidy dependency graph." },
  { owner: "pmndrs", name: "zustand", about: "State management with React bindings and middleware." },
  { owner: "colinhacks", name: "zod", about: "Schema validation: a larger graph with packages." },
] as const;

export type Example = (typeof EXAMPLES)[number];

export function fullNameOf(example: Example): string {
  return `${example.owner}/${example.name}`;
}

/** Only the public record counts. A private or local copy with the same name is someone's own. */
export function isExampleRow(row: { full_name: string; owner_user_id: string | null }): boolean {
  if (row.owner_user_id !== null) return false;
  const name = row.full_name.toLowerCase();
  return EXAMPLES.some((example) => fullNameOf(example).toLowerCase() === name);
}
