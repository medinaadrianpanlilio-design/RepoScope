import { describe, expect, it } from "vitest";
import { connectionStatus, installationSettingsUrl, syncedByGithubId } from "./connection-view";

describe("syncedByGithubId", () => {
  const rows = [
    { id: "a", github_id: 1 },
    { id: "b", github_id: 2 },
  ];

  it("keeps each repository's newest finished analysis", () => {
    const runs = [
      { repository_id: "a", commit_sha: "new", completed_at: "2026-11-10T00:00:00Z" },
      { repository_id: "a", commit_sha: "old", completed_at: "2026-11-09T00:00:00Z" },
    ];
    expect(syncedByGithubId(rows, runs).get(1)).toEqual({
      repositoryId: "a",
      commitSha: "new",
      completedAt: "2026-11-10T00:00:00Z",
    });
  });

  it("lists an imported repository that was never analyzed, with no commit", () => {
    expect(syncedByGithubId(rows, []).get(2)).toEqual({
      repositoryId: "b",
      commitSha: null,
      completedAt: null,
    });
  });

  it("skips rows without a GitHub id", () => {
    expect(syncedByGithubId([{ id: "c", github_id: null }], []).size).toBe(0);
  });
});

describe("connectionStatus", () => {
  const healthy = { revokedAt: null, suspendedAt: null, problem: null };

  it("is connected when nothing is wrong", () => {
    expect(connectionStatus(healthy)).toBe("connected");
  });

  it("is uninstalled when the webhook said so or GitHub refuses a token", () => {
    expect(connectionStatus({ ...healthy, revokedAt: "2026-11-10T00:00:00Z" })).toBe("uninstalled");
    expect(connectionStatus({ ...healthy, problem: "revoked" })).toBe("uninstalled");
  });

  it("is suspended either way too", () => {
    expect(connectionStatus({ ...healthy, suspendedAt: "2026-11-10T00:00:00Z" })).toBe("suspended");
    expect(connectionStatus({ ...healthy, problem: "suspended" })).toBe("suspended");
  });

  it("needs attention for any other problem", () => {
    expect(connectionStatus({ ...healthy, problem: "under_permissioned" })).toBe("attention");
    expect(connectionStatus({ ...healthy, problem: "rate_limited" })).toBe("attention");
  });
});

describe("installationSettingsUrl", () => {
  it("points a personal account at its own settings", () => {
    expect(
      installationSettingsUrl({ accountType: "User", accountLogin: "me", githubInstallationId: 42 }),
    ).toBe("https://github.com/settings/installations/42");
  });

  it("points an organization at the organization's settings", () => {
    expect(
      installationSettingsUrl({ accountType: "Organization", accountLogin: "acme", githubInstallationId: 42 }),
    ).toBe("https://github.com/organizations/acme/settings/installations/42");
  });

  it("never builds a path from a login GitHub couldn't have issued", () => {
    expect(
      installationSettingsUrl({
        accountType: "Organization",
        accountLogin: "../evil",
        githubInstallationId: 42,
      }),
    ).toBe("https://github.com/settings/installations/42");
  });
});
