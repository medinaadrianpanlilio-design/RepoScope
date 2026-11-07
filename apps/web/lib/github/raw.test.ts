import { describe, expect, it, vi } from "vitest";
import { fetchSourceFile } from "./raw";

const sha = "a".repeat(40);

function respond(body: string, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(body, { status }));
}

describe("fetchSourceFile", () => {
  it("reads a file at the exact analyzed commit", async () => {
    const fetchImpl = respond("export const a = 1;\n");

    expect(await fetchSourceFile("o", "r", sha, "src/a.ts", { fetchImpl })).toEqual({
      ok: true,
      content: "export const a = 1;\n",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://raw.githubusercontent.com/o/r/${sha}/src/a.ts`);
  });

  it("encodes unusual characters in a path", async () => {
    const fetchImpl = respond("x");
    await fetchSourceFile("o", "r", sha, "app/(auth)/[id]/a b#c?.ts", { fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://raw.githubusercontent.com/o/r/${sha}/app/(auth)/%5Bid%5D/a%20b%23c%3F.ts`,
    );
  });

  it("never follows a redirect", async () => {
    const fetchImpl = respond("x");
    await fetchSourceFile("o", "r", sha, "a.ts", { fetchImpl });

    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
  });

  it.each([
    ["bad owner", "o/../x", "r", sha, "a.ts"],
    ["bad repository", "o", "r?x=1", sha, "a.ts"],
    ["branch instead of commit", "o", "r", "main", "a.ts"],
    ["path traversal", "o", "r", sha, "../secret.ts"],
    ["absolute path", "o", "r", sha, "/etc/passwd"],
  ])("rejects %s before any request", async (_label, owner, repo, commit, path) => {
    const fetchImpl = respond("x");

    expect(await fetchSourceFile(owner, repo, commit, path, { fetchImpl })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a missing file", async () => {
    expect(await fetchSourceFile("o", "r", sha, "a.ts", { fetchImpl: respond("", 404) })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("reports other failures", async () => {
    expect(await fetchSourceFile("o", "r", sha, "a.ts", { fetchImpl: respond("", 500) })).toEqual({
      ok: false,
      error: "upstream",
    });
  });

  it("stops reading a file past the size limit", async () => {
    const result = await fetchSourceFile("o", "r", sha, "a.ts", {
      fetchImpl: respond("x".repeat(100)),
      maxBytes: 10,
    });

    expect(result).toEqual({ ok: false, error: "too_large" });
  });
});
