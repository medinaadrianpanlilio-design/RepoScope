import { describe, expect, it, vi } from "vitest";
import { downloadArchive } from "./archive";

const SHA = "a".repeat(40);
const CODELOAD = "https://codeload.github.com/o/r/legacy.tar.gz/" + SHA;

function redirect(location: string | null) {
  return new Response(null, { status: 302, headers: location ? { location } : {} });
}

function streamOf(...chunks: number[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(1));
        controller.close();
      },
    }),
  );
}

describe("downloadArchive", () => {
  it("follows GitHub's redirect to codeload and returns the bytes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect(CODELOAD))
      .mockResolvedValueOnce(streamOf(10, 5));
    const result = await downloadArchive("o", "r", SHA, { token: "secret", fetchImpl });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.bytes.length).toBe(15);
    expect(fetchImpl.mock.calls[0]![1].headers.authorization).toBe("Bearer secret");
    expect(fetchImpl.mock.calls[1]![0]).toBe(CODELOAD);
    expect(fetchImpl.mock.calls[1]![1].headers.authorization).toBeUndefined();
  });

  it("refuses a redirect to any other host", async () => {
    for (const location of [
      "https://evil.example/x.tar.gz",
      "http://codeload.github.com/x",
      "https://codeload.github.com.evil.example/x",
      "https://user@codeload.github.com/x",
      "https://codeload.github.com:8443/x",
      "http://169.254.169.254/latest",
    ]) {
      const fetchImpl = vi.fn().mockResolvedValueOnce(redirect(location));
      expect(await downloadArchive("o", "r", SHA, { fetchImpl })).toEqual({
        ok: false,
        error: "upstream",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects names and commits that aren't valid before any request", async () => {
    const fetchImpl = vi.fn();
    for (const [owner, repo, sha] of [
      ["o/../x", "r", SHA],
      ["o", "r?x=1", SHA],
      ["o", "r", "main"],
    ] as const) {
      expect(await downloadArchive(owner, repo, sha, { fetchImpl })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops reading once the download passes the limit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect(CODELOAD))
      .mockResolvedValueOnce(streamOf(60, 60));
    expect(await downloadArchive("o", "r", SHA, { fetchImpl, maxBytes: 100 })).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("rejects early when content-length is already over the limit", async () => {
    const big = streamOf(1);
    const withLength = new Response(big.body, { headers: { "content-length": "500" } });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect(CODELOAD))
      .mockResolvedValueOnce(withLength);
    expect(await downloadArchive("o", "r", SHA, { fetchImpl, maxBytes: 100 })).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("maps 404, rate limits and network failures", async () => {
    expect(
      await downloadArchive("o", "r", SHA, {
        fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      }),
    ).toEqual({ ok: false, error: "not_found" });

    const limited = new Response(null, {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" },
    });
    expect(
      await downloadArchive("o", "r", SHA, { fetchImpl: vi.fn().mockResolvedValue(limited) }),
    ).toEqual({ ok: false, error: "rate_limited", resetAt: "2027-01-15T08:00:00.000Z" });

    expect(
      await downloadArchive("o", "r", SHA, {
        fetchImpl: vi.fn().mockRejectedValue(new Error("network")),
      }),
    ).toEqual({ ok: false, error: "upstream" });
  });
});
