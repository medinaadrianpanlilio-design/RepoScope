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
});
