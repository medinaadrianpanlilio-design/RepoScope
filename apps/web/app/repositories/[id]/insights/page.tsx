import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { generateInsights } from "@/lib/graph/insights";
import { loadGraph } from "@/lib/graph/load";
import { getRepository } from "@/lib/repositories/queries";
import { RepoTabs } from "../repo-tabs";
import { InsightList } from "./insight-list";

export const metadata: Metadata = { title: "Insights" };

type Props = PageProps<"/repositories/[id]/insights">;

export default function InsightsPage({ params }: Props) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-sm text-muted">Reading the analysis…</p>}>
        <Insights params={params} />
      </Suspense>
    </main>
  );
}

async function Insights({ params }: Pick<Props, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const repository = await getRepository(id);
  if (!repository) notFound();

  const run = await getLatestCompletedRun(id);

  return (
    <>
      <h1 className="truncate font-mono text-xl font-bold tracking-tight sm:text-2xl">{repository.full_name}</h1>
      <div className="mt-2">
        <RepoTabs repositoryId={id} active="insights" />
      </div>

      {run ? (
        <Results repositoryId={id} analysisId={run.id} stats={run.stats as AnalysisStats} />
      ) : (
        <div className="mt-6 rounded-md border border-dashed border-line p-8">
          <h2 className="font-medium">No insights yet</h2>
          <p className="mt-1 text-sm text-muted">
            Insights appear once this repository has been analyzed.
          </p>
          <Link
            href={`/repositories/${id}/overview`}
            className="mt-3 inline-block text-sm text-accent underline underline-offset-2 hover:decoration-2"
          >
            Go to the overview
          </Link>
        </div>
      )}
    </>
  );
}

async function Results({
  repositoryId,
  analysisId,
  stats,
}: {
  repositoryId: string;
  analysisId: string;
  stats: AnalysisStats;
}) {
  const graph = await loadGraph(analysisId);
  const insights = generateInsights({
    files: graph.files,
    edges: graph.edges,
    unresolved: graph.unresolved,
    cycles: stats.cycles,
    cycleCount: stats.cycleCount,
  });

  return <InsightList repositoryId={repositoryId} insights={insights} />;
}
