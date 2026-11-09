import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appCredentials, requestInstallationToken, type GitHubToken, type TokenError } from "./app-auth";
import {
  installationRepositories,
  linkDecision,
  summarizeLinks,
  userInstallations,
  userRepositoryIds,
  type ConnectCode,
  type LinkOutcome,
  type ReachableRepository,
  type UserInstallation,
} from "./connect";
import { openTokenSource } from "./installation-tokens";

const MAX_INSTALLATIONS = 20;

/**
 * An installation belongs to whoever connected it first. Nobody else can take it over. The
 * repositories just checked against the user are the only ones RepoScope will open through it.
 */
async function claim(
  userId: string,
  installation: UserInstallation,
  verifiedIds: number[],
): Promise<LinkOutcome> {
  const db = createAdminClient();
  const { data: existing, error } = await db
    .from("github_installations")
    .select("id, user_id")
    .eq("github_installation_id", installation.githubInstallationId)
    .maybeSingle();
  if (error) throw new Error(`Could not check installation: ${error.code}`);
  if (existing && existing.user_id !== userId) return "claimed";

  const fields = {
    account_login: installation.accountLogin,
    account_type: installation.accountType,
    suspended_at: installation.suspendedAt,
    verified_repository_ids: verifiedIds,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateError } = await db
      .from("github_installations")
      .update(fields)
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (updateError) throw new Error(`Could not update installation: ${updateError.code}`);
    return "linked";
  }

  const { error: insertError } = await db.from("github_installations").insert({
    ...fields,
    user_id: userId,
    github_installation_id: installation.githubInstallationId,
  });
  if (insertError?.code === "23505") return "claimed"; // Someone connected it a moment earlier.
  if (insertError) throw new Error(`Could not save installation: ${insertError.code}`);
  return "linked";
}

async function consider(
  userId: string,
  userToken: GitHubToken,
  installation: UserInstallation,
): Promise<LinkOutcome> {
  const credentials = appCredentials(process.env);
  if (!credentials) return "not_configured";

  const issued = await requestInstallationToken(credentials, installation.githubInstallationId);
  if (!issued.ok) {
    if (issued.error === "not_configured") return "not_configured";
    return issued.error === "rate_limited" ? "rate_limited" : "unavailable";
  }

  const [reached, visible] = await Promise.all([
    installationRepositories(issued.token),
    userRepositoryIds(userToken, installation.githubInstallationId),
  ]);
  if (!reached.ok || !visible.ok) {
    const limited = [reached, visible].some((list) => !list.ok && list.error === "rate_limited");
    return limited ? "rate_limited" : "unavailable";
  }

  const decision = linkDecision(
    reached.items.map((repository) => repository.githubId),
    visible.items,
    reached.complete && visible.complete,
  );
  if (decision !== "link") return decision;
  return claim(
    userId,
    installation,
    reached.items.map((repository) => repository.githubId),
  );
}

/** Links every installation the user may have, checked with their own short-lived token. */
export async function connectInstallations(userId: string, userToken: GitHubToken): Promise<ConnectCode> {
  if (!appCredentials(process.env)) return "not_configured";

  const listed = await userInstallations(userToken);
  if (!listed.ok) return listed.error === "rate_limited" ? "rate_limited" : "failed";

  const outcomes: LinkOutcome[] = [];
  for (const installation of listed.items.slice(0, MAX_INSTALLATIONS)) {
    outcomes.push(await consider(userId, userToken, installation));
  }
  return summarizeLinks(outcomes);
}

export type Connection = {
  id: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  suspendedAt: string | null;
  revokedAt: string | null;
  /** Each one says whether it passed the check when the user connected. */
  repositories: (ReachableRepository & { verified: boolean })[];
  complete: boolean;
  problem: TokenError | "rate_limited" | null;
};

type InstallationRow = {
  id: string;
  github_installation_id: number;
  account_login: string;
  account_type: "User" | "Organization";
  suspended_at: string | null;
  revoked_at: string | null;
  verified_repository_ids: number[];
};

async function describe(row: InstallationRow): Promise<Connection> {
  const base = {
    id: row.id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    suspendedAt: row.suspended_at,
    revokedAt: row.revoked_at,
    repositories: [],
    complete: true,
  };

  const issued = await openTokenSource(row)();
  if (!issued.ok) return { ...base, problem: issued.error };

  const reached = await installationRepositories(issued.token);
  if (!reached.ok) return { ...base, problem: reached.error };

  const verified = new Set(row.verified_repository_ids);
  const repositories = reached.items.map((repository) => ({
    ...repository,
    verified: verified.has(repository.githubId),
  }));
  return { ...base, repositories, complete: reached.complete, problem: null };
}

/** The server client bypasses Row Level Security, so the filter on user_id is the access check. */
export async function listConnections(userId: string): Promise<Connection[]> {
  const { data, error } = await createAdminClient()
    .from("github_installations")
    .select(
      "id, github_installation_id, account_login, account_type, suspended_at, revoked_at, verified_repository_ids",
    )
    .eq("user_id", userId)
    .order("created_at")
    .overrideTypes<InstallationRow[], { merge: false }>();

  if (error) throw new Error(`Could not list installations: ${error.code}`);
  return Promise.all(data.map(describe));
}
