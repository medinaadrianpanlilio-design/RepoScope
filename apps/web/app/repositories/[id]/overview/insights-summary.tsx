import Link from "next/link";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { generateInsights } from "@/lib/graph/insights";
import { loadGraph } from "@/lib/graph/load";

const SHOWN = 4;

type Props = { repositoryId: string; analysisId: string; stats: AnalysisStats };

export async function InsightsSummary({ repositoryId, analysisId, stats }: Props) {
  const { files, edges, unresolved } = await loadGraph(analysisId);
  const insights = generateInsights({
    files,
    edges,
    unresolved,
    cycles: stats.cycles,
    cycleCount: stats.cycleCount,
  });

  return (
    <section className="mt-10">
      <h2 className="font-medium">Architecture summary</h2>
      {insights.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing stood out in this analysis.</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1 text-sm">
            {insights.slice(0, SHOWN).map((insight) => (
              <li key={insight.id}>
                <span>{insight.title}: </span>
                <span className="text-muted">{insight.description}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/repositories/${repositoryId}/insights`}
            className="mt-2 inline-block text-sm text-accent hover:underline"
          >
            See all {insights.length} insights
          </Link>
        </>
      )}
    </section>
  );
}
