import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./app-auth";

const tokens = vi.hoisted(() => ({
  installationOf: vi.fn(),
  installationForAccount: vi.fn(),
  issue: vi.fn(),
  openTokenSource: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./installation-tokens", () => ({
  installationOf: tokens.installationOf,
  installationForAccount: tokens.installationForAccount,
  openTokenSource: tokens.openTokenSource,
}));

import { describeAccess, findPrivateRepository, openRepository } from "./repository-access";

const installation = { id: "inst", github_installation_id: 42, suspended_at: null, revoked_at: null };
const privateRow = { owner: "me", name: "secret", github_id: 7, installation_id: "inst" };
const publicRow = { owner: "vercel", name: "next.js", github_id: 1, installation_id: null };
const sha = "c".repeat(40);
const github = vi.fn<typeof fetch>();

beforeEach(() => {
  for (const mock of Object.values(tokens)) mock.mockReset();
  tokens.openTokenSource.mockImplementation(() => tokens.issue);
  tokens.issue.mockResolvedValue({ ok: true, token: new GitHubToken("ghs_job", Date.now() + 3_600_000) });
  github.mockReset();
  github.mockResolvedValue(new Response(sha, { status: 200 }));
  vi.stubGlobal("fetch", github);
});

afterEach(() => vi.unstubAllGlobals());

function sentAuthorization() {
  return (github.mock.calls[0]![1]?.headers as Record<string, string>).authorization;
}

describe("openRepository", () => {
  it("opens a public repository with no installation involved", async () => {
    const access = await openRepository(publicRow, null);

    expect(access.ok).toBe(true);
    expect(tokens.installationOf).not.toHaveBeenCalled();
  });

  it("refuses a private repository to a visitor without asking GitHub", async () => {
    expect(await openRepository(privateRow, null)).toEqual({ ok: false, error: "not_found" });
    expect(tokens.installationOf).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it("refuses a user whose installation it isn't, before any token is made", async () => {
    tokens.installationOf.mockResolvedValue(null);

    expect(await openRepository(privateRow, "intruder")).toEqual({ ok: false, error: "not_found" });
    expect(tokens.installationOf).toHaveBeenCalledWith("intruder", "inst");
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it("asks for a fresh token limited to this one repository", async () => {
    tokens.installationOf.mockResolvedValue(installation);
    const access = await openRepository(privateRow, "owner");

    expect(tokens.openTokenSource).toHaveBeenCalledWith(installation, { repositoryIds: [7] });
    expect(access.ok).toBe(true);
    if (!access.ok) return;

    expect(await access.reader.latestCommit("main")).toEqual({ ok: true, sha });
    expect(sentAuthorization()).toBe("Bearer ghs_job");
  });

  it("passes on why GitHub refused, such as the repository being removed from the App", async () => {
    tokens.installationOf.mockResolvedValue(installation);
    tokens.issue.mockResolvedValue({ ok: false, error: "no_access" });

    expect(await openRepository(privateRow, "owner")).toEqual({ ok: false, error: "no_access" });
  });
});

describe("findPrivateRepository", () => {
  const body = {
    id: 7,
    name: "secret",
    full_name: "me/secret",
    owner: { login: "me" },
    html_url: "https://github.com/me/secret",
    description: null,
    default_branch: "main",
    language: "TypeScript",
    private: true,
  };

  it("says when the user hasn't connected that account", async () => {
    tokens.installationForAccount.mockResolvedValue(null);

    expect(await findPrivateRepository("owner", "me", "secret")).toEqual({
      ok: false,
      error: "not_connected",
    });
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it("finds a private repository with the installation's token", async () => {
    tokens.installationForAccount.mockResolvedValue(installation);
    github.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    expect(await findPrivateRepository("owner", "me", "secret")).toMatchObject({
      ok: true,
      found: { installationId: "inst", repository: { githubId: 7, isPrivate: true } },
    });
    expect(tokens.installationForAccount).toHaveBeenCalledWith("owner", "me");
    expect(sentAuthorization()).toBe("Bearer ghs_job");
  });

  it("reports a repository the installation can't see as not found", async () => {
    tokens.installationForAccount.mockResolvedValue(installation);
    github.mockResolvedValue(new Response("{}", { status: 404 }));

    expect(await findPrivateRepository("owner", "me", "secret")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("reports an uninstalled App", async () => {
    tokens.installationForAccount.mockResolvedValue({ ...installation, revoked_at: "2026-11-09" });
    tokens.issue.mockResolvedValue({ ok: false, error: "revoked" });

    expect(await findPrivateRepository("owner", "me", "secret")).toEqual({
      ok: false,
      error: "revoked",
    });
  });
});

describe("describeAccess", () => {
  it.each([
    "not_found",
    "not_connected",
    "revoked",
    "suspended",
    "no_access",
    "under_permissioned",
    "not_configured",
    "rate_limited",
    "upstream",
  ] as const)("explains %s", (error) => {
    const failure = describeAccess(error);
    expect(failure.message.length).toBeGreaterThan(10);
    expect(failure.status).toBeGreaterThanOrEqual(400);
  });
});
