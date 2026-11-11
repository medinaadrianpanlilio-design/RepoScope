import Link from "next/link";
import { formatDate, shortSha } from "@/lib/analysis/present";
import { connectMessage, oauthCredentials } from "@/lib/github/connect";
import {
  connectionStatus,
  installationSettingsUrl,
  type ConnectionStatus,
  type Synced,
} from "@/lib/github/connection-view";
import { listConnections, type Connection } from "@/lib/github/connections";
import { DisconnectButton } from "./disconnect-button";
import { OpenRepository } from "./open-repository";

const MAX_SHOWN = 50;

const PROBLEMS: Record<NonNullable<Connection["problem"]>, string> = {
  revoked: "RepoScope was uninstalled from this account on GitHub, so its repositories can't be read.",
  suspended: "This installation is suspended on GitHub. Unsuspend it there to read its repositories.",
  under_permissioned:
    "The App's permissions changed and haven't been accepted on GitHub. Accept them under Installed GitHub Apps.",
  no_access: "GitHub refused access to these repositories.",
  not_configured: "The GitHub App isn't set up correctly on this server.",
  rate_limited: "GitHub is limiting requests right now. Reload in a few minutes.",
  upstream: "We couldn't reach GitHub. Reload in a minute.",
};

const STATUS: Record<ConnectionStatus, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "border-accent/50 text-accent" },
  suspended: { label: "Suspended", tone: "border-danger/60 text-danger" },
  uninstalled: { label: "Uninstalled", tone: "border-danger/60 text-danger" },
  attention: { label: "Needs attention", tone: "border-danger/60 text-danger" },
};

const TONES = {
  good: "border-accent/50",
  info: "border-line",
  problem: "border-danger/60",
};

const SMALL_BUTTON =
  "shrink-0 rounded border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent";

export async function GitHubPanel({ userId, outcome }: { userId: string; outcome?: string }) {
  const message = connectMessage(outcome);
  const configured = oauthCredentials(process.env) !== null;
  const connections = configured ? await listConnections(userId) : [];

  return (
    <section aria-label="GitHub" className="mt-10">
      <h2 className="font-medium">Private repositories on GitHub</h2>
      <p className="mt-1 text-sm text-muted">
        Install the RepoScope App on your GitHub account to reach private repositories. It can only read
        code, never change it, and you choose which repositories it sees.
      </p>

      {message && (
        <p role="status" className={`mt-3 rounded-md border bg-card p-3 text-sm ${TONES[message.tone]}`}>
          {message.text}
        </p>
      )}

      {configured ? (
        <>
          <a href="/api/github/connect" className="button-secondary mt-3 inline-block">
            {connections.length > 0 ? "Connect another account" : "Connect GitHub"}
          </a>
          <p className="mt-2 text-xs text-muted">
            Already installed the App, but GitHub left you on its settings page?{" "}
            <a href="/api/github/callback" className="text-accent underline underline-offset-2 hover:decoration-2">
              Finish connecting
            </a>
            .
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">The GitHub App isn&apos;t set up on this server yet.</p>
      )}

      {connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
    </section>
  );
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const status = connectionStatus(connection);
  const problem = connection.revokedAt ? "revoked" : connection.problem;
  const shown = connection.repositories.slice(0, MAX_SHOWN);
  const hidden = connection.repositories.length - shown.length;

  return (
    <div className="mt-4 rounded-md border border-line bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{connection.accountLogin}</span>
          <span className="text-muted">
            {" "}
            · {connection.accountType === "Organization" ? "Organization" : "Personal account"}
          </span>
        </span>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${STATUS[status].tone}`}>
          {STATUS[status].label}
        </span>
        <a
          href={installationSettingsUrl(connection)}
          target="_blank"
          rel="noreferrer noopener"
          className={SMALL_BUTTON}
        >
          Manage on GitHub
        </a>
        <DisconnectButton
          installationId={connection.id}
          accountLogin={connection.accountLogin}
          label={status === "uninstalled" ? "Remove" : "Disconnect"}
        />
      </div>

      {status === "connected" && (
        <p className="border-b border-line px-3 py-2 text-xs text-muted">
          Permissions: read code and read metadata. Nothing else, so RepoScope can&apos;t change anything
          on GitHub.
        </p>
      )}

      {problem ? (
        <p role="status" className="px-3 py-3 text-sm text-danger">
          {PROBLEMS[problem]}
        </p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          This installation can&apos;t see any repositories yet. Choose some on GitHub.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line text-sm">
            {shown.map((repository) => (
              <li key={repository.githubId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{repository.fullName}</span>
                {repository.synced && <SyncedLabel synced={repository.synced} />}
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${
                    repository.isPrivate ? "border-accent-2/60 text-accent-2" : "border-line text-muted"
                  }`}
                >
                  {repository.isPrivate ? "Private" : "Public"}
                </span>
                {repository.isPrivate && !repository.verified ? (
                  <a
                    href="/api/github/callback"
                    title="Added on GitHub after you connected. Connecting again checks you can see it."
                    className={SMALL_BUTTON}
                  >
                    Connect again
                  </a>
                ) : repository.synced ? (
                  <Link
                    href={`/repositories/${repository.synced.repositoryId}/overview`}
                    aria-label={`Open ${repository.fullName}`}
                    className={SMALL_BUTTON}
                  >
                    Open
                  </Link>
                ) : (
                  <OpenRepository fullName={repository.fullName} />
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 py-2 text-xs text-muted">
            {hidden > 0 && `And ${hidden.toLocaleString("en-US")} more. `}
            {!connection.complete && "Only the first 1,000 are listed. "}
            Private repositories open only for you. Pushes to their default branch are analyzed on their
            own. Their source is read from GitHub when you view it, never stored.
          </p>
        </>
      )}
    </div>
  );
}

function SyncedLabel({ synced }: { synced: Synced }) {
  if (!synced.commitSha || !synced.completedAt) {
    return <span className="shrink-0 text-xs text-muted">Not analyzed yet</span>;
  }
  return (
    <span className="shrink-0 text-xs text-muted">
      Synced <span className="font-mono">{shortSha(synced.commitSha)}</span> on {formatDate(synced.completedAt)}
    </span>
  );
}
