import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { displayStatus } from "@/lib/analysis/claim";
import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { getLatestCompletedRun, getLatestRun } from "@/lib/analysis/store";
import { getRepository } from "@/lib/repositories/queries";
import { AnalysisPanel } from "./analysis-panel";
import { AnalysisResults } from "./analysis-results";

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

      <dl className="mt-8 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        <Fact label="Default branch" value={repository.default_branch} />
        <Fact label="Primary language" value={repository.primary_language ?? "Not reported"} />
        <div className="bg-card p-4">
          <dt className="text-xs text-muted">Source</dt>
          <dd className="mt-1 text-sm">
            <a
              href={repository.github_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              View on GitHub <ExternalLink size={14} aria-hidden />
            </a>
          </dd>
        </div>
      </dl>

      <AnalysisPanel
        key={panelKey}
        repositoryId={repository.id}
        run={run}
        hasResults={completed !== null}
        autoStart={analyze === "1"}
      />

      {completed && (
        <AnalysisResults
          stats={completed.stats as AnalysisStats}
          commitSha={completed.commit_sha}
          completedAt={completed.completed_at}
        />
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
