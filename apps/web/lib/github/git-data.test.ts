import { describe, expect, it, vi } from "vitest";
import { fetchBlob, fetchTree } from "./git-data";

const sha = "a".repeat(40);
const blob = (path: string, mode = "100644", size = 3) => ({
  path,
  mode,
  type: "blob",
  sha: "b".repeat(40),
  size,
});

function respond(body: BodyInit | null, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(body, { status }));
}

describe("fetchTree", () => {
  it("lists regular files only, as GitHub's archive does", async () => {
    const fetchImpl = respond(
      JSON.stringify({
        truncated: false,
        tree: [
          blob("src/a.ts"),
          blob("bin/run", "100755"),
          blob("link.ts", "120000"),
          { path: "src", mode: "040000", type: "tree", sha: "c".repeat(40) },
          { path: "vendor/lib", mode: "160000", type: "commit", sha: "d".repeat(40) },
        ],
      }),
    );

    expect(await fetchTree("me", "repo", sha, { fetchImpl })).toEqual({
      ok: true,
      entries: 5,
      files: [
        { path: "src/a.ts", sha: "b".repeat(40), size: 3 },
        { path: "bin/run", sha: "b".repeat(40), size: 3 },
      ],
    });
  });

  it("reports a list GitHub cut short, rather than a partial one", async () => {
    const fetchImpl = respond(JSON.stringify({ truncated: true, tree: [blob("a.ts")] }));
    expect(await fetchTree("me", "repo", sha, { fetchImpl })).toEqual({ ok: false, error: "truncated" });
  });

  it("sends the token to GitHub's API only when there is one", async () => {
    const fetchImpl = respond(JSON.stringify({ truncated: false, tree: [] }));
    await fetchTree("me", "repo", sha, { fetchImpl, token: "ghs_x" });
    await fetchTree("me", "repo", sha, { fetchImpl });

    const [withToken, without] = fetchImpl.mock.calls;
    expect(withToken![0]).toBe(`https://api.github.com/repos/me/repo/git/trees/${sha}?recursive=1`);
    expect((withToken![1]!.headers as Record<string, string>).authorization).toBe("Bearer ghs_x");
    expect(without![1]!.headers).not.toHaveProperty("authorization");
  });

  it("refuses odd names and commits without asking GitHub", async () => {
    const fetchImpl = respond("{}");
    expect(await fetchTree("me/../x", "repo", sha, { fetchImpl })).toMatchObject({ ok: false });
    expect(await fetchTree("me", "repo", "main", { fetchImpl })).toMatchObject({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports missing commits and bad answers", async () => {
    expect(await fetchTree("me", "repo", sha, { fetchImpl: respond("{}", 404) })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await fetchTree("me", "repo", sha, { fetchImpl: respond("not json") })).toEqual({
      ok: false,
      error: "upstream",
    });
  });
});

describe("fetchBlob", () => {
  it("returns a file's bytes", async () => {
    const fetchImpl = respond(new Uint8Array([1, 0, 2]));
    expect(await fetchBlob("me", "repo", sha, { fetchImpl, maxBytes: 10 })).toEqual({
      ok: true,
      bytes: new Uint8Array([1, 0, 2]),
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`https://api.github.com/repos/me/repo/git/blobs/${sha}`);
  });

  it("stops reading past the limit", async () => {
    const fetchImpl = respond("x".repeat(11));
    expect(await fetchBlob("me", "repo", sha, { fetchImpl, maxBytes: 10 })).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("reports a failed request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    expect(await fetchBlob("me", "repo", sha, { fetchImpl, maxBytes: 10 })).toEqual({
      ok: false,
      error: "upstream",
    });
  });
});
