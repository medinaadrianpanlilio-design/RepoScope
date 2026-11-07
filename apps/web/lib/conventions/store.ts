import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toConvention, toRowFields, type Convention, type ConventionInput, type ConventionRow } from "./schema";

const MAX_PER_REPOSITORY = 100;
const COLUMNS = "id, kind, rule_from, rule_to, rule_mode, note_body, note_path";

/** Reads as the signed-in user, so Row Level Security limits this to their own. */
export async function listConventions(repositoryId: string): Promise<Convention[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conventions")
    .select(COLUMNS)
    .eq("repository_id", repositoryId)
    .order("created_at")
    .overrideTypes<ConventionRow[], { merge: false }>();

  if (error) throw new Error(`Could not list conventions: ${error.code}`);
  return data.map(toConvention);
}

export async function createConvention(userId: string, repositoryId: string, input: ConventionInput) {
  if ((await listConventions(repositoryId)).length >= MAX_PER_REPOSITORY) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conventions")
    .insert({ user_id: userId, repository_id: repositoryId, kind: input.kind, ...toRowFields(input) })
    .select(COLUMNS)
    .single()
    .overrideTypes<ConventionRow, { merge: false }>();

  if (error) throw new Error(`Could not save convention: ${error.code}`);
  return toConvention(data);
}

export async function updateConvention(repositoryId: string, id: string, input: ConventionInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conventions")
    .update({ ...toRowFields(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("repository_id", repositoryId)
    .eq("kind", input.kind)
    .select(COLUMNS)
    .overrideTypes<ConventionRow[], { merge: false }>();

  if (error) throw new Error(`Could not update convention: ${error.code}`);
  return data[0] ? toConvention(data[0]) : null;
}

export async function deleteConvention(repositoryId: string, id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conventions")
    .delete()
    .eq("id", id)
    .eq("repository_id", repositoryId)
    .select("id");

  if (error) throw new Error(`Could not delete convention: ${error.code}`);
  return data.length > 0;
}

/**
 * For MCP, where there's no signed-in session. The server client bypasses Row Level Security,
 * so the filter on user_id is what keeps one person's Conventions from another.
 */
export async function conventionsOf(userId: string, repositoryId: string): Promise<Convention[]> {
  const { data, error } = await createAdminClient()
    .from("conventions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("repository_id", repositoryId)
    .order("created_at")
    .overrideTypes<ConventionRow[], { merge: false }>();

  if (error) throw new Error(`Could not list conventions: ${error.code}`);
  return data.map(toConvention);
}
