import "server-only";
import type { RepositoryMetadata } from "@/lib/github/client";
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
};

export type SavedRepository = Repository & { saved_at: string };

const COLUMNS =
  "id, owner, name, full_name, github_url, description, default_branch, primary_language, created_at";

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
  return data.map((row) => ({ ...row.repositories, saved_at: row.created_at }));
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
