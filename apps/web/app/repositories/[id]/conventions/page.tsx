import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { getOptionalUser } from "@/lib/auth";
import { getRepository } from "@/lib/repositories/queries";
import { RepoTabs } from "../repo-tabs";
import { ConventionsManager } from "./conventions-manager";
import { FoundConventions } from "./found-conventions";

export const metadata: Metadata = { title: "Conventions" };

type Props = PageProps<"/repositories/[id]/conventions">;

export default function ConventionsPage({ params }: Props) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-sm text-muted">Loading repository…</p>}>
        <Conventions params={params} />
      </Suspense>
    </main>
  );
}

async function Conventions({ params }: Pick<Props, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const repository = await getRepository(id);
  if (!repository) notFound();

  const user = await getOptionalUser();

  return (
    <>
      <h1 className="truncate font-mono text-sm font-semibold">{repository.full_name}</h1>
      <div className="mt-2">
        <RepoTabs repositoryId={id} active="conventions" />
      </div>

      {user ? (
        <ConventionsManager repositoryId={id} />
      ) : (
        <div className="mt-6 rounded-md border border-dashed border-line p-8">
          <h2 className="font-medium">Sign in to keep Conventions</h2>
          <p className="mt-1 text-sm text-muted">
            Import rules and notes are private to you, even on a public repository.
          </p>
          <Link href="/login" className="mt-3 inline-block text-sm text-accent hover:underline">
            Sign in
          </Link>
        </div>
      )}

      <FoundConventions repositoryId={id} />
    </>
  );
}
