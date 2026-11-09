import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appCredentials, requestInstallationToken, statusChange, tokenSource } from "./app-auth";

export type Installation = {
  id: string;
  github_installation_id: number;
  suspended_at: string | null;
  revoked_at: string | null;
};

const COLUMNS = "id, github_installation_id, suspended_at, revoked_at";

/** The server client bypasses Row Level Security, so the filter on user_id is the access check. */
export async function installationOf(userId: string, id: string): Promise<Installation | null> {
  const { data, error } = await createAdminClient()
    .from("github_installations")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not load installation: ${error.code}`);
  return data;
}

/**
 * The user's installation on one GitHub account, if they connected it. A live one wins over a
 * removed one, so the caller can tell "not connected" from "uninstalled".
 */
export async function installationForAccount(
  userId: string,
  accountLogin: string,
): Promise<Installation | null> {
  // GitHub logins are letters, digits and hyphens, so nothing here can act as a wildcard.
  if (!/^[a-z\d-]{1,39}$/i.test(accountLogin)) return null;

  const { data, error } = await createAdminClient()
    .from("github_installations")
    .select(COLUMNS)
    .eq("user_id", userId)
    .ilike("account_login", accountLogin)
    .order("revoked_at", { ascending: false, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load installation: ${error.code}`);
  return data;
}

/**
 * Tokens for one job. Open a new source for each job and let it go afterwards, so a token never
 * outlives the work it was made for. A removed installation can't come back, so it isn't retried.
 */
export function openTokenSource(
  installation: Installation,
  { repositoryIds }: { repositoryIds?: number[] } = {},
) {
  return tokenSource(async () => {
    if (installation.revoked_at) return { ok: false, error: "revoked" };

    const credentials = appCredentials(process.env);
    if (!credentials) return { ok: false, error: "not_configured" };

    const result = await requestInstallationToken(credentials, installation.github_installation_id, {
      repositoryIds,
    });

    const change = statusChange(installation, result);
    if (change) {
      await createAdminClient()
        .from("github_installations")
        .update({ ...change, updated_at: new Date().toISOString() })
        .eq("id", installation.id);
    }
    return result;
  });
}
