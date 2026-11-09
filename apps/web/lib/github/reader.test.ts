import { describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./app-auth";
import { privateReader, publicReader } from "./reader";

const sha = "b".repeat(40);
const target = { owner: "me", name: "app" };

function github() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/commits/")) return new Response(sha, { status: 200 });
    if (url.includes("/tarball/")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://codeload.github.com/me/app/legacy.tar.gz/x?token=temp" },
      });
    }
    return new Response("code", { status: 200 });
  });
}

function authorization(fetchImpl: ReturnType<typeof github>, call: number) {
  const headers = fetchImpl.mock.calls[call]![1]?.headers as Record<string, string>;
  return headers.authorization;
}

describe("privateReader", () => {
  it("uses the installation token for every step, and only toward GitHub's API", async () => {
    const fetchImpl = github();
    const reader = privateReader(target, new GitHubToken("ghs_private", Date.now() + 3_600_000), {
      fetchImpl,
    });

    expect(await reader.latestCommit("main")).toEqual({ ok: true, sha });
    await reader.download(sha);
    expect(await reader.file(sha, "src/a.ts")).toEqual({ ok: true, content: "code" });

    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toBe("https://api.github.com/repos/me/app/commits/main");
    expect(urls[1]).toBe(`https://api.github.com/repos/me/app/tarball/${sha}`);
    expect(urls[2]).toMatch(/^https:\/\/codeload\.github\.com\//);
    expect(urls[3]).toBe(`https://api.github.com/repos/me/app/contents/src/a.ts?ref=${sha}`);

    expect(authorization(fetchImpl, 0)).toBe("Bearer ghs_private");
    expect(authorization(fetchImpl, 1)).toBe("Bearer ghs_private");
    expect(authorization(fetchImpl, 2)).toBeUndefined();
    expect(authorization(fetchImpl, 3)).toBe("Bearer ghs_private");
  });

  it("can't be printed or serialized with its token", () => {
    const reader = privateReader(target, new GitHubToken("ghs_private", Date.now() + 3_600_000));
    expect(JSON.stringify(reader)).not.toContain("ghs_private");
  });
});

describe("publicReader", () => {
  it("sends the server's token to the API and nothing to raw files", async () => {
    const fetchImpl = github();
    const reader = publicReader(target, { token: "server", fetchImpl });

    await reader.latestCommit("main");
    await reader.file(sha, "a.ts");

    expect(authorization(fetchImpl, 0)).toBe("Bearer server");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      `https://raw.githubusercontent.com/me/app/${sha}/a.ts`,
    );
    expect(authorization(fetchImpl, 1)).toBeUndefined();
  });

  it("works without a server token", async () => {
    const fetchImpl = github();
    await publicReader(target, { fetchImpl }).latestCommit("main");
    expect(authorization(fetchImpl, 0)).toBeUndefined();
  });
});
