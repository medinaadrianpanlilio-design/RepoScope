import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { getRepository } from "@/lib/repositories/queries";
import { RepoTabs } from "../repo-tabs";
import { GraphExplorer } from "./graph-explorer";

export const metadata: Metadata = { title: "Architecture" };

type Props = PageProps<"/repositories/[id]/architecture">;

export default function ArchitecturePage({ params }: Props) {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<p className="p-4 text-sm text-muted">Loading repository…</p>}>
        <Architecture params={params} />
      </Suspense>
    </main>
  );
}

async function Architecture({ params }: Pick<Props, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const repository = await getRepository(id);
  if (!repository) notFound();

  const run = await getLatestCompletedRun(id);

  return (
    <>
      <div className="px-4 pt-4">
        <h1 className="truncate font-mono text-sm font-semibold">{repository.full_name}</h1>
        <div className="mt-2">
          <RepoTabs repositoryId={id} active="architecture" />
        </div>
      </div>

      {run ? (
        <GraphExplorer analysisId={run.id} />
      ) : (
        <div className="m-4 rounded-md border border-dashed border-line p-8">
          <h2 className="font-medium">Nothing to map yet</h2>
          <p className="mt-1 text-sm text-muted">
            The graph appears once this repository has been analyzed.
          </p>
          <Link href={`/repositories/${id}/overview`} className="mt-3 inline-block text-sm text-accent hover:underline">
            Go to the overview
          </Link>
        </div>
      )}
    </>
  );
}
