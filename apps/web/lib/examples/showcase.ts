import "server-only";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { demoLayout, type DemoGraph } from "@/lib/graph/demo-layout";
import { reach } from "@/lib/graph/details";
import { changeImpact } from "@/lib/graph/impact";
import { generateInsights, type Insight } from "@/lib/graph/insights";
import { loadGraph } from "@/lib/graph/load";
import { impactOf } from "@/lib/mcp/answers";
import type { ReadyExample } from "./queries";

/** The example the home page is built around: big enough to be interesting, small enough to read. */
export const SHOWCASE = "pmndrs/zustand";

export type Showcase = {
  repositoryId: string;
  fullName: string;
  commitSha: string;
  totals: { sourceFiles: number; dependencies: number; cycles: number };
  languages: { language: string; files: number }[];
  graph: DemoGraph;
  /** The file the most code depends on, and how far a change to it reaches. */
  hub: { path: string; direct: number; total: number } | null;
  /** What MCP's get_impact answers for the hub, shortened. */
  impactAnswer: ReturnType<typeof impactOf> | null;
  insight: Insight | null;
};

/** Everything on the home page that comes from a real analysis. Null if that analysis isn't ready. */
export async function loadShowcase(examples: ReadyExample[]): Promise<Showcase | null> {
  const example = examples.find((candidate) => candidate.fullName === SHOWCASE);
  if (!example) return null;

  const run = await getLatestCompletedRun(example.repositoryId);
  if (!run) return null;
  const data = await loadGraph(run.id);
  const stats = run.stats as AnalysisStats;

  const usedBy = new Map(data.files.map((file) => [file.id, reach(data, file.id, "importedBy").count]));
  const hubFile = [...data.files].sort(
    (a, b) => usedBy.get(b.id)! - usedBy.get(a.id)! || a.path.localeCompare(b.path),
  )[0];
  const directImporters = hubFile
    ? new Set(data.edges.filter((edge) => edge.target === hubFile.id).map((edge) => edge.source)).size
    : 0;

  const insight =
    generateInsights({
      files: data.files,
      edges: data.edges,
      cycles: [],
      cycleCount: stats.cycleCount ?? 0,
      unresolved: data.unresolved,
    })[0] ?? null;

  return {
    repositoryId: example.repositoryId,
    fullName: example.fullName,
    commitSha: run.commit_sha ?? "",
    totals: {
      sourceFiles: stats.totals.sourceFiles,
      dependencies: stats.totals.internalDependencies,
      cycles: stats.cycleCount ?? 0,
    },
    languages: [...(stats.languages ?? [])]
      .map(({ language, files }) => ({ language, files }))
      .sort((a, b) => b.files - a.files),
    graph: demoLayout(data),
    hub: hubFile
      ? { path: hubFile.path, direct: directImporters, total: changeImpact(data, [hubFile.id]).length }
      : null,
    impactAnswer: hubFile
      ? impactOf({ ...data, cycles: [], otherFiles: null, otherFileCount: 0 }, [hubFile], 4)
      : null,
    insight,
  };
}
