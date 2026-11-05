import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportForm } from "@/components/import-form";
import { requireUser } from "@/lib/auth";
import { listSavedRepositories } from "@/lib/repositories/queries";
import { RepositoryList } from "./repository-list";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <Suspense fallback={<p className="text-sm text-muted">Loading your repositories…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const user = await requireUser();
  const repositories = await listSavedRepositories();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {user.email}</p>

      <section aria-label="Import a repository" className="mt-8 max-w-2xl">
        <ImportForm />
      </section>

      <section aria-label="Your repositories" className="mt-10">
        {repositories.length === 0 ? (
          <div className="rounded-md border border-dashed border-line p-10 text-center">
            <h2 className="font-medium">No repositories yet</h2>
            <p className="mt-1 text-sm text-muted">
              Import a public repository above and it will appear here.
            </p>
          </div>
        ) : (
          <RepositoryList repositories={repositories} />
        )}
      </section>
    </>
  );
}
