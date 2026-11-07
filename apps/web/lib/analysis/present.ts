const STEPS = [
  { status: "queued", label: "Queued" },
  { status: "fetching", label: "Downloading from GitHub" },
  { status: "scanning", label: "Scanning files" },
  { status: "parsing", label: "Parsing imports and resolving dependencies" },
  { status: "saving", label: "Saving results" },
];

export type StepState = "done" | "active" | "waiting";

export function isActive(status: string): boolean {
  return STEPS.some((step) => step.status === status);
}

export function progressSteps(status: string): { label: string; state: StepState }[] {
  const current = STEPS.findIndex((step) => step.status === status);
  return STEPS.map(({ label }, index) => ({
    label,
    state: current === -1 || index > current ? "waiting" : index === current ? "active" : "done",
  }));
}

export function analysisLabel(run: { status: string; completedAt: string | null } | null): string {
  if (!run) return "Not analyzed yet";
  if (run.status === "failed") return "Analysis failed";
  if (run.status === "completed" && run.completedAt) return `Analyzed ${formatDate(run.completedAt)}`;
  return "Analysis in progress";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function languageShares<T extends { lines: number }>(languages: T[]) {
  const total = languages.reduce((sum, language) => sum + language.lines, 0);
  return languages.map((language) => ({
    ...language,
    percent: total === 0 ? 0 : Math.round((language.lines / total) * 100),
  }));
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
