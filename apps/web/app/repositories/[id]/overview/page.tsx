import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getRepository } from "@/lib/repositories/queries";

type Props = PageProps<"/repositories/[id]/overview">;

export default function OverviewPage({ params }: Props) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <Suspense fallback={<p className="text-sm text-muted">Loading repository…</p>}>
        <Overview params={params} />
      </Suspense>
    </main>
  );
}

async function Overview({ params }: Pick<Props, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const repository = await getRepository(id);
  if (!repository) notFound();

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

      <div className="mt-8 rounded-md border border-dashed border-line p-8">
        <h2 className="font-medium">Not analyzed yet</h2>
        <p className="mt-1 text-sm text-muted">
          This repository is imported, but RepoScope&apos;s analysis engine isn&apos;t built yet.
          Files, dependencies and the architecture graph will appear here once it is.
        </p>
      </div>
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
