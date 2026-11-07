import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { displayStatus } from "@/lib/analysis/claim";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getLatestCompletedRun, getLatestRun } from "@/lib/analysis/store";
import { getRepository } from "@/lib/repositories/queries";
import { AnalysisPanel } from "./analysis-panel";
import { RepoTabs } from "../repo-tabs";
import { AnalysisResults } from "./analysis-results";
import { InsightsSummary } from "./insights-summary";

type Props = PageProps<"/repositories/[id]/overview">;

export default function OverviewPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <Suspense fallback={<p className="text-sm text-muted">Loading repository…</p>}>
        <Overview params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Overview({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { id } = await params;
  const { analyze } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const repository = await getRepository(id);
  if (!repository) notFound();

  const [latest, completed] = await Promise.all([getLatestRun(id), getLatestCompletedRun(id)]);
  const run = latest && { id: latest.id, ...displayStatus(latest, new Date()) };
  const panelKey = `${run?.id ?? "none"}:${run?.status ?? "none"}`;

  return (
    <>
      <h1 className="font-mono text-2xl font-semibold tracking-tight break-words">
        {repository.full_name}
      </h1>
      {repository.description && <p className="mt-2 text-muted">{repository.description}</p>}

      <div className="mt-6">
        <RepoTabs repositoryId={repository.id} active="overview" />
      </div>

      <dl className="mt-8 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        <Fact label="Default branch" value={repository.default_branch} />
        <Fact label="Primary language" value={repository.primary_language ?? "Not reported"} />
        <div className="bg-card p-4">
          <dt className="text-xs text-muted">Source</dt>
          <dd className="mt-1 text-sm">
            {repository.source === "local" ? (
              "Local folder, private to you"
            ) : (
              <a
                href={repository.github_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                View on GitHub <ExternalLink size={14} aria-hidden />
              </a>
            )}
          </dd>
        </div>
      </dl>

      {repository.source === "local" ? (
        <p className="mt-8 text-sm text-muted">
          This folder updates when you run <code className="font-mono">reposcope sync</code> on your
          PC. Its source stays there.
        </p>
      ) : (
        <AnalysisPanel
          key={panelKey}
          repositoryId={repository.id}
          run={run}
          hasResults={completed !== null}
          autoStart={analyze === "1"}
        />
      )}

      {completed && (
        <AnalysisResults
          stats={completed.stats as AnalysisStats}
          commitSha={completed.commit_sha}
          baseCommitSha={completed.base_commit_sha}
          completedAt={completed.completed_at}
        />
      )}

      {completed && (
        <Suspense fallback={<p className="mt-10 text-sm text-muted">Reading the analysis…</p>}>
          <InsightsSummary
            repositoryId={repository.id}
            analysisId={completed.id}
            stats={completed.stats as AnalysisStats}
          />
        </Suspense>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm">{value}</dd>
    </div>
  );
}
