/** What the dashboard says about one connected GitHub account. Pure, so it can be tested. */

export type Synced = { repositoryId: string; commitSha: string | null; completedAt: string | null };

type PrivateRow = { id: string; github_id: number | null };
type CompletedRun = { repository_id: string; commit_sha: string | null; completed_at: string | null };

/**
 * Each imported private repository's latest finished analysis, keyed by its GitHub id. A repository
 * imported but never analyzed still appears, with no commit, so the dashboard can open it.
 * `runs` must be newest first.
 */
export function syncedByGithubId(rows: PrivateRow[], runs: CompletedRun[]): Map<number, Synced> {
  const latest = new Map<string, CompletedRun>();
  for (const run of runs) if (!latest.has(run.repository_id)) latest.set(run.repository_id, run);

  const synced = new Map<number, Synced>();
  for (const row of rows) {
    if (row.github_id === null) continue;
    const run = latest.get(row.id);
    synced.set(row.github_id, {
      repositoryId: row.id,
      commitSha: run?.commit_sha ?? null,
      completedAt: run?.completed_at ?? null,
    });
  }
  return synced;
}

export type ConnectionStatus = "connected" | "suspended" | "uninstalled" | "attention";

export function connectionStatus(connection: {
  revokedAt: string | null;
  suspendedAt: string | null;
  problem: string | null;
}): ConnectionStatus {
  if (connection.revokedAt || connection.problem === "revoked") return "uninstalled";
  if (connection.suspendedAt || connection.problem === "suspended") return "suspended";
  return connection.problem ? "attention" : "connected";
}

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

/**
 * Where the account's owner manages or uninstalls the App on GitHub. RepoScope can only forget an
 * Installation; removing it from GitHub is the owner's call.
 */
export function installationSettingsUrl(connection: {
  accountType: "User" | "Organization";
  accountLogin: string;
  githubInstallationId: number;
}): string {
  const id = Math.trunc(connection.githubInstallationId);
  if (connection.accountType === "Organization" && LOGIN.test(connection.accountLogin)) {
    return `https://github.com/organizations/${connection.accountLogin}/settings/installations/${id}`;
  }
  return `https://github.com/settings/installations/${id}`;
}
