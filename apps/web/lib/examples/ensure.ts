import "server-only";
import { startAnalysis } from "@/lib/analysis/start";
import { fetchRepositoryMetadata, type RepositoryLookup } from "@/lib/github/client";
import { publicReader, type RepositoryReader } from "@/lib/github/reader";
import { upsertRepository } from "@/lib/repositories/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { EXAMPLES, fullNameOf, type Example } from "./list";

export type ExampleOutcome = "ready" | "started" | "running" | "unavailable";

type Deps = {
  lookup: (example: Example) => Promise<RepositoryLookup>;
  upsert: typeof upsertRepository;
  hasResults: (repositoryId: string) => Promise<boolean>;
  reader: (owner: string, name: string) => RepositoryReader;
  start: (repositoryId: string, commitSha: string, reader: RepositoryReader) => Promise<{ start: boolean }>;
};

const token = () => process.env.GITHUB_TOKEN;

const defaults: Deps = {
  lookup: (example) => fetchRepositoryMetadata(example.owner, example.name, { token: token() }),
  upsert: upsertRepository,
  hasResults: async (repositoryId) => {
    const { count, error } = await createAdminClient()
      .from("analysis_runs")
      .select("id", { count: "exact", head: true })
      .eq("repository_id", repositoryId)
      .eq("status", "completed");
    if (error) throw new Error(`Could not check example: ${error.code}`);
    return (count ?? 0) > 0;
  },
  reader: (owner, name) => publicReader({ owner, name }, { token: token() }),
  start: startAnalysis,
};

/**
 * Imports each example and analyzes it once if it has no results yet. Importing refreshes its
 * facts and its last-used time. One failing example never stops the others or the daily job.
 */
export async function ensureExamples(deps: Deps = defaults): Promise<Record<string, ExampleOutcome>> {
  const outcomes: Record<string, ExampleOutcome> = {};
  for (const example of EXAMPLES) {
    try {
      outcomes[fullNameOf(example)] = await ensureOne(example, deps);
    } catch (error) {
      console.error("Example failed:", error instanceof Error ? error.message : "unknown error");
      outcomes[fullNameOf(example)] = "unavailable";
    }
  }
  return outcomes;
}

async function ensureOne(example: Example, deps: Deps): Promise<ExampleOutcome> {
  const lookup = await deps.lookup(example);
  if (!lookup.ok || lookup.repository.isPrivate) return "unavailable";

  const repositoryId = await deps.upsert(lookup.repository);
  if (await deps.hasResults(repositoryId)) return "ready";

  const reader = deps.reader(lookup.repository.owner, lookup.repository.name);
  const commit = await reader.latestCommit(lookup.repository.defaultBranch);
  if (!commit.ok) return "unavailable";

  const { start } = await deps.start(repositoryId, commit.sha, reader);
  return start ? "started" : "running";
}
