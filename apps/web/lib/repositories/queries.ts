import "server-only";
import { displayStatus, type RunRecord } from "@/lib/analysis/claim";
import { analysisLabel } from "@/lib/analysis/present";
import type { RepositoryMetadata } from "@/lib/github/client";
import type { PrivateFound } from "@/lib/github/repository-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type Repository = {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  github_url: string;
  description: string | null;
  default_branch: string;
  primary_language: string | null;
  created_at: string;
  source: "github" | "local";
  remote_full_name: string | null;
  github_id: number | null;
  installation_id: string | null;
  is_private: boolean;
};

export type SavedRepository = Repository & { saved_at: string; analysis_label: string };

const COLUMNS =
  "id, owner, name, full_name, github_url, description, default_branch, primary_language, created_at, source, remote_full_name, github_id, installation_id, is_private";

export async function upsertRepository(repository: RepositoryMetadata): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("repositories")
    .upsert(
      {
        github_id: repository.githubId,
        owner: repository.owner,
        name: repository.name,
        full_name: repository.fullName,
        github_url: repository.githubUrl,
        description: repository.description,
        default_branch: repository.defaultBranch,
        primary_language: repository.primaryLanguage,
        is_private: repository.isPrivate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "github_id" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`Could not store repository: ${error.code}`);
  return data.id;
}

/**
 * Stores a private repository under the user who connected its installation. A repository that
 * was public before is converted in one update, and everyone else's saved copy is removed, so it
 * leaves their dashboards as well as their reach. Returns null when someone else owns it.
 */
export async function upsertPrivateRepository(
  userId: string,
  { repository, installationId }: PrivateFound,
  retried = false,
): Promise<string | null> {
  const db = createAdminClient();
  const { data: existing, error } = await db
    .from("repositories")
    .select("id, owner_user_id")
    .eq("github_id", repository.githubId)
    .maybeSingle();
  if (error) throw new Error(`Could not check repository: ${error.code}`);
  if (existing?.owner_user_id && existing.owner_user_id !== userId) return null;

  const fields = {
    owner: repository.owner,
    name: repository.name,
    full_name: repository.fullName,
    github_url: repository.githubUrl,
    description: repository.description,
    default_branch: repository.defaultBranch,
    primary_language: repository.primaryLanguage,
    source: "github",
    is_private: true,
    owner_user_id: userId,
    installation_id: installationId,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateError } = await db.from("repositories").update(fields).eq("id", existing.id);
    if (updateError) throw new Error(`Could not update repository: ${updateError.code}`);

    if (!existing.owner_user_id) {
      const { error: unsaveError } = await db
        .from("saved_repositories")
        .delete()
        .eq("repository_id", existing.id)
        .neq("user_id", userId);
      if (unsaveError) throw new Error(`Could not unsave repository: ${unsaveError.code}`);
    }
    return existing.id;
  }

  const { data, error: insertError } = await db
    .from("repositories")
    .insert({ ...fields, github_id: repository.githubId })
    .select("id")
    .single();
  // Someone stored it a moment earlier, so look again and decide from that row.
  if (insertError?.code === "23505" && !retried) {
    return upsertPrivateRepository(userId, { repository, installationId }, true);
  }
  if (insertError) throw new Error(`Could not store repository: ${insertError.code}`);
  return data.id;
}

export async function saveRepository(userId: string, repositoryId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("saved_repositories")
    .upsert(
      { user_id: userId, repository_id: repositoryId },
      { onConflict: "user_id,repository_id", ignoreDuplicates: true },
    );

  if (error) throw new Error(`Could not save repository: ${error.code}`);
}

export async function getRepository(id: string): Promise<Repository | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repositories")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load repository: ${error.code}`);
  return data;
}

export async function listSavedRepositories(): Promise<SavedRepository[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_repositories")
    .select(`created_at, repositories (${COLUMNS})`)
    .order("created_at", { ascending: false })
    .overrideTypes<{ created_at: string; repositories: Repository }[], { merge: false }>();

  if (error) throw new Error(`Could not list repositories: ${error.code}`);

  const latestRuns = await latestRunsByRepository(data.map((row) => row.repositories.id));
  return data.map((row) => ({
    ...row.repositories,
    saved_at: row.created_at,
    analysis_label: labelFor(latestRuns.get(row.repositories.id)),
  }));
}

type DashboardRun = RunRecord & { repository_id: string; completed_at: string | null };

async function latestRunsByRepository(ids: string[]) {
  const latest = new Map<string, DashboardRun>();
  if (ids.length === 0) return latest;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, repository_id, status, error_message, created_at, started_at, completed_at")
    .in("repository_id", ids)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load analysis status: ${error.code}`);
  for (const run of data) {
    if (!latest.has(run.repository_id)) latest.set(run.repository_id, run);
  }
  return latest;
}

function labelFor(run: DashboardRun | undefined): string {
  if (!run) return analysisLabel(null);
  return analysisLabel({
    status: displayStatus(run, new Date()).status,
    completedAt: run.completed_at,
  });
}

/** Removes the repository from the user's dashboard. The shared record stays. */
export async function removeSavedRepository(userId: string, repositoryId: string) {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("saved_repositories")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("repository_id", repositoryId);

  if (error) throw new Error(`Could not remove repository: ${error.code}`);
  return (count ?? 0) > 0;
}
