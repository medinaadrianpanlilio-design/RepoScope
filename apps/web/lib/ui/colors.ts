/** One color per language, the same in every graph and on the home page. */
export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#60a5fa",
  TSX: "#a78bfa",
  JavaScript: "#facc15",
  JSX: "#fb923c",
};

export const UNKNOWN_LANGUAGE_COLOR = "#94a3b8";

export function languageColor(language: string): string {
  return LANGUAGE_COLORS[language] ?? UNKNOWN_LANGUAGE_COLOR;
}

/** Bright, distinct hues for folder clusters in the 3D graph, readable on the dark canvas. */
export const CLUSTER_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#fb923c",
  "#4ade80",
  "#f472b6",
  "#facc15",
  "#60a5fa",
  "#f87171",
  "#2dd4bf",
  "#c084fc",
];

/** Files with no imports either way. */
export const ORPHAN_COLOR = "#64748b";
