import { describe, expect, it, vi } from "vitest";
import type { RepositoryMetadata } from "@/lib/github/client";
import { importRepository, type ImportDeps } from "./import";

const metadata: RepositoryMetadata = {
  githubId: 1,
  owner: "vercel",
  name: "next.js",
  fullName: "vercel/next.js",
  githubUrl: "https://github.com/vercel/next.js",
  description: null,
  defaultBranch: "canary",
  primaryLanguage: "JavaScript",
  isPrivate: false,
};

function deps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    allow: vi.fn(async () => true),
    lookup: vi.fn(async () => ({ ok: true as const, repository: metadata })),
    upsert: vi.fn(async () => "repo-id"),
    save: vi.fn(async () => undefined),
    ...overrides,
  };
}

const url = "https://github.com/vercel/next.js";

describe("importRepository", () => {
  it("stores the repository and returns its id", async () => {
    const d = deps();

    expect(await importRepository({ url, userId: null }, d)).toEqual({
      ok: true,
      repositoryId: "repo-id",
    });
    expect(d.lookup).toHaveBeenCalledWith("vercel", "next.js");
    expect(d.upsert).toHaveBeenCalledWith(metadata);
  });

  it("works without an account and saves nothing to a dashboard", async () => {
    const d = deps();
    await importRepository({ url, userId: null }, d);

    expect(d.save).not.toHaveBeenCalled();
  });

  it("saves to the dashboard of a signed-in user", async () => {
    const d = deps();
    await importRepository({ url, userId: "user-1" }, d);

    expect(d.save).toHaveBeenCalledWith("user-1", "repo-id");
  });

  it("rejects an invalid URL without calling GitHub", async () => {
    const d = deps();
    const result = await importRepository({ url: "https://evil.example/a/b", userId: null }, d);

    expect(result).toMatchObject({ ok: false, code: "invalid_url", status: 400 });
    expect(d.lookup).not.toHaveBeenCalled();
    expect(d.allow).not.toHaveBeenCalled();
  });

  it("stops before calling GitHub when the visitor is over the limit", async () => {
    const d = deps({ allow: vi.fn(async () => false) });
    const result = await importRepository({ url, userId: null }, d);

    expect(result).toMatchObject({ ok: false, code: "too_many_requests", status: 429 });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("says a missing repository may be private, and stores nothing", async () => {
    const d = deps({ lookup: vi.fn(async () => ({ ok: false as const, error: "not_found" as const })) });
    const result = await importRepository({ url, userId: null }, d);

    expect(result).toMatchObject({ ok: false, code: "not_found", status: 404 });
    expect(result.ok === false && result.message).toMatch(/private/i);
    expect(d.upsert).not.toHaveBeenCalled();
  });

  it("reports a rate limit", async () => {
    const d = deps({
      lookup: vi.fn(async () => ({
        ok: false as const,
        error: "rate_limited" as const,
        resetAt: "2026-11-05T04:00:00.000Z",
      })),
    });

    expect(await importRepository({ url, userId: null }, d)).toMatchObject({
      ok: false,
      code: "rate_limited",
      status: 429,
    });
  });

  it("reports a GitHub outage", async () => {
    const d = deps({ lookup: vi.fn(async () => ({ ok: false as const, error: "upstream" as const })) });

    expect(await importRepository({ url, userId: null }, d)).toMatchObject({
      ok: false,
      code: "github_unavailable",
      status: 502,
    });
  });

  describe("a repository GitHub hides from the server", () => {
    const hidden = { ok: false as const, error: "not_found" as const };
    const privateMetadata = { ...metadata, isPrivate: true };

    function withPrivate(lookupResult: unknown, upsertResult: string | null = "private-id") {
      const priv = {
        lookup: vi.fn(async () => lookupResult as never),
        upsert: vi.fn(async () => upsertResult),
        describe: vi.fn(() => ({ code: "github_revoked", message: "Uninstalled.", status: 403 })),
      };
      return { priv, d: deps({ lookup: vi.fn(async () => hidden), private: priv }) };
    }

    it("imports it through the user's own installation, owned by them", async () => {
      const found = { repository: privateMetadata, installationId: "inst" };
      const { priv, d } = withPrivate({ ok: true, found });

      expect(await importRepository({ url, userId: "user-1" }, d)).toEqual({
        ok: true,
        repositoryId: "private-id",
      });
      expect(priv.lookup).toHaveBeenCalledWith("vercel", "next.js");
      expect(priv.upsert).toHaveBeenCalledWith(found);
      expect(d.upsert).not.toHaveBeenCalled();
      expect(d.save).toHaveBeenCalledWith("user-1", "private-id");
    });

    it("never looks through installations for a visitor", async () => {
      const { priv, d } = withPrivate({ ok: true, found: {} });
      const result = await importRepository({ url, userId: null }, d);

      expect(result).toMatchObject({ ok: false, code: "not_found" });
      expect(priv.lookup).not.toHaveBeenCalled();
    });

    it("only looks when GitHub said not found, not on a rate limit or outage", async () => {
      const { priv } = withPrivate({ ok: true, found: {} });
      const d = deps({
        lookup: vi.fn(async () => ({ ok: false as const, error: "upstream" as const })),
        private: priv,
      });

      expect(await importRepository({ url, userId: "user-1" }, d)).toMatchObject({
        code: "github_unavailable",
      });
      expect(priv.lookup).not.toHaveBeenCalled();
    });

    it("stores a public repository the installation found on the public path", async () => {
      const { priv, d } = withPrivate({ ok: true, found: { repository: metadata, installationId: "i" } });

      expect(await importRepository({ url, userId: "user-1" }, d)).toEqual({
        ok: true,
        repositoryId: "repo-id",
      });
      expect(d.upsert).toHaveBeenCalledWith(metadata);
      expect(priv.upsert).not.toHaveBeenCalled();
    });

    it("says to choose the repository on GitHub when the installation can't see it", async () => {
      const { d } = withPrivate(hidden);
      const result = await importRepository({ url, userId: "user-1" }, d);

      expect(result).toMatchObject({ ok: false, code: "not_found", status: 404 });
      expect(result.ok === false && result.message).toMatch(/App's settings on GitHub/);
      expect(d.save).not.toHaveBeenCalled();
    });

    it("explains why an installation can't be used", async () => {
      const { priv, d } = withPrivate({ ok: false, error: "revoked" });

      expect(await importRepository({ url, userId: "user-1" }, d)).toEqual({
        ok: false,
        code: "github_revoked",
        message: "Uninstalled.",
        status: 403,
      });
      expect(priv.describe).toHaveBeenCalledWith("revoked");
    });

    it("refuses a repository someone else owns, and saves nothing", async () => {
      const found = { repository: privateMetadata, installationId: "inst" };
      const { d } = withPrivate({ ok: true, found }, null);

      expect(await importRepository({ url, userId: "user-1" }, d)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(d.save).not.toHaveBeenCalled();
    });
  });
});

