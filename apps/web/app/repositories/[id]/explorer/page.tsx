import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { getRepository } from "@/lib/repositories/queries";
import { RepoTabs } from "../repo-tabs";
import { FileExplorer } from "./file-explorer";

export const metadata: Metadata = { title: "Explorer" };

type Props = PageProps<"/repositories/[id]/explorer">;

export default function ExplorerPage({ params, searchParams }: Props) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<p className="p-4 text-sm text-muted">Loading repository…</p>}>
        <Explorer params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Explorer({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { id } = await params;
  const { file } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const repository = await getRepository(id);
  if (!repository) notFound();

  const run = await getLatestCompletedRun(id);
  const initialFileId = Number(file);

  return (
    <>
      <div className="px-4 pt-4">
        <h1 className="truncate font-mono text-sm font-semibold">{repository.full_name}</h1>
        <div className="mt-2">
          <RepoTabs repositoryId={id} active="explorer" />
        </div>
      </div>

      {run ? (
        <FileExplorer
          repositoryId={id}
          analysisId={run.id}
          repositoryUrl={repository.source === "github" ? repository.github_url : ""}
          commitSha={run.commit_sha ?? ""}
          initialFileId={Number.isSafeInteger(initialFileId) ? initialFileId : null}
        />
      ) : (
        <div className="m-4 rounded-md border border-dashed border-line p-8">
          <h2 className="font-medium">Nothing to explore yet</h2>
          <p className="mt-1 text-sm text-muted">
            Files appear once this repository has been analyzed.
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
