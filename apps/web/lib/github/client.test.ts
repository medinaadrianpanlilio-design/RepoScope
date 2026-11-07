import { describe, expect, it, vi } from "vitest";
import { fetchLatestCommit, fetchRepositoryMetadata } from "./client";

const repoBody = {
  id: 70107786,
  name: "next.js",
  full_name: "vercel/next.js",
  owner: { login: "vercel" },
  html_url: "https://github.com/vercel/next.js",
  description: "The React Framework",
  default_branch: "canary",
  language: "JavaScript",
  private: false,
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers }),
  );
}

describe("fetchRepositoryMetadata", () => {
  it("maps a repository", async () => {
    const result = await fetchRepositoryMetadata("vercel", "next.js", {
      fetchImpl: respond(200, repoBody),
    });

    expect(result).toEqual({
      ok: true,
      repository: {
        githubId: 70107786,
        owner: "vercel",
        name: "next.js",
        fullName: "vercel/next.js",
        githubUrl: "https://github.com/vercel/next.js",
        description: "The React Framework",
        defaultBranch: "canary",
        primaryLanguage: "JavaScript",
        isPrivate: false,
      },
    });
  });

  it("only calls the GitHub API, with encoded names", async () => {
    const fetchImpl = respond(200, repoBody);
    await fetchRepositoryMetadata("vercel", "next.js", { fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.github.com/repos/vercel/next.js");
  });

  it("sends the token only when one is configured", async () => {
    const withToken = respond(200, repoBody);
    await fetchRepositoryMetadata("a", "b", { fetchImpl: withToken, token: "secret" });
    const withoutToken = respond(200, repoBody);
    await fetchRepositoryMetadata("a", "b", { fetchImpl: withoutToken });

    const headersOf = (mock: typeof withToken) =>
      new Headers(mock.mock.calls[0][1]?.headers);
    expect(headersOf(withToken).get("authorization")).toBe("Bearer secret");
    expect(headersOf(withoutToken).has("authorization")).toBe(false);
  });

  it("treats 404 as not found or private, which GitHub can't tell apart", async () => {
    const result = await fetchRepositoryMetadata("a", "b", {
      fetchImpl: respond(404, { message: "Not Found" }),
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it.each([403, 429])("reports a %i rate limit with its reset time", async (status) => {
    const result = await fetchRepositoryMetadata("a", "b", {
      fetchImpl: respond(status, {}, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1793850000",
      }),
    });

    expect(result).toEqual({
      ok: false,
      error: "rate_limited",
      resetAt: new Date(1793850000 * 1000).toISOString(),
    });
  });

  it("reports other 403s as upstream failures, not rate limits", async () => {
    const result = await fetchRepositoryMetadata("a", "b", {
      fetchImpl: respond(403, { message: "Forbidden" }),
    });

    expect(result).toEqual({ ok: false, error: "upstream" });
  });

  it("refuses a private repository even when a token can see it", async () => {
    const result = await fetchRepositoryMetadata("a", "b", {
      fetchImpl: respond(200, { ...repoBody, private: true }),
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("reports network failures", async () => {
    const result = await fetchRepositoryMetadata("a", "b", {
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error("socket hang up");
      }),
    });

    expect(result).toEqual({ ok: false, error: "upstream" });
  });

  it("reports an unexpected response shape", async () => {
    const result = await fetchRepositoryMetadata("a", "b", {
      fetchImpl: respond(200, { hello: "world" }),
    });

    expect(result).toEqual({ ok: false, error: "upstream" });
  });
});

describe("fetchLatestCommit", () => {
  const sha = "a".repeat(40);
  const text = (status: number, body: string) =>
    vi.fn<typeof fetch>(async () => new Response(body, { status }));

  it("returns the branch's commit", async () => {
    const fetchImpl = text(200, sha);

    expect(await fetchLatestCommit("o", "r", "feature/x", { fetchImpl })).toEqual({ ok: true, sha });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.github.com/repos/o/r/commits/feature%2Fx");
  });

  it("refuses anything that isn't a commit hash", async () => {
    expect(await fetchLatestCommit("o", "r", "main", { fetchImpl: text(200, "<html>") })).toEqual({
      ok: false,
      error: "upstream",
    });
  });

  it("reports a missing branch or an empty repository", async () => {
    for (const status of [404, 422]) {
      expect(await fetchLatestCommit("o", "r", "main", { fetchImpl: text(status, "") })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });
});
