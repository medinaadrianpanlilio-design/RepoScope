import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { runPipeline, type PipelineDeps, type SnapshotDeps } from "./pipeline";
import { blobSha, type Snapshot } from "./snapshot";

function tarGz(files: Record<string, string>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(`repo-abc/${path}`, 0);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\x0000", 257);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function deps(overrides: Partial<PipelineDeps> = {}) {
  const statuses: string[] = [];
  const d = {
    download: vi.fn(async () => ({
      ok: true as const,
      bytes: tarGz({ "a.ts": 'import "./b";\n', "b.ts": "export const b = 1;\n" }),
    })),
    setStatus: vi.fn(async (status: string) => {
      statuses.push(status);
    }),
    save: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
  return { d, statuses };
}

describe("runPipeline", () => {
  it("analyzes a repository, saves the results, then completes", async () => {
    const { d, statuses } = deps();
    await runPipeline(d);

    expect(statuses).toEqual(["fetching", "scanning", "parsing", "saving"]);
    expect(d.save).toHaveBeenCalledOnce();
    expect(d.complete).toHaveBeenCalledOnce();
    expect(d.fail).not.toHaveBeenCalled();
  });

  it("saves real edges and stats without any source code", async () => {
    const { d } = deps();
    await runPipeline(d);

    const saved = JSON.stringify(vi.mocked(d.save).mock.calls);
    expect(saved).toContain('"target":"b.ts"');
    expect(saved).not.toContain("export const b = 1");
    expect(JSON.stringify(vi.mocked(d.complete).mock.calls)).toContain('"sourceFiles":2');
  });

  it("records non-code files and the analysis version", async () => {
    const { d } = deps({
      download: vi.fn(async () => ({
        ok: true as const,
        bytes: tarGz({ "a.ts": "export {};\n", "logo.svg": "<svg/>" }),
      })),
    });
    await runPipeline(d);

    expect(vi.mocked(d.complete).mock.calls[0]?.[0]).toMatchObject({
      version: "2",
      otherFiles: ["logo.svg"],
      otherFileCount: 1,
    });
  });

  it("only completes after saving finishes", async () => {
    const order: string[] = [];
    const { d } = deps({
      save: vi.fn(async () => {
        order.push("save");
      }),
      complete: vi.fn(async () => {
        order.push("complete");
      }),
    });
    await runPipeline(d);

    expect(order).toEqual(["save", "complete"]);
  });

  it.each([
    ["too_large", /too large/i],
    ["not_found", /no longer available/i],
    ["upstream", /couldn't download/i],
  ] as const)("fails clearly when the download reports %s", async (error, message) => {
    const { d } = deps({ download: vi.fn(async () => ({ ok: false as const, error })) });
    await runPipeline(d);

    expect(d.fail).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(d.complete).not.toHaveBeenCalled();
  });

  it("fails clearly on a rate limit", async () => {
    const { d } = deps({
      download: vi.fn(async () => ({
        ok: false as const,
        error: "rate_limited" as const,
        resetAt: null,
      })),
    });
    await runPipeline(d);

    expect(d.fail).toHaveBeenCalledWith(expect.stringMatching(/rate limit/i));
  });

  it("fails on a corrupt archive", async () => {
    const { d } = deps({
      download: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array([1, 2, 3]) })),
    });
    await runPipeline(d);

    expect(d.fail).toHaveBeenCalledOnce();
    expect(d.save).not.toHaveBeenCalled();
  });

  it("names the limit a repository exceeded", async () => {
    const { d } = deps();
    await runPipeline(d, { maxSourceFiles: 1 });

    expect(d.fail).toHaveBeenCalledWith(expect.stringMatching(/2 JS\/TS files.*limit is 1/));
    expect(d.save).not.toHaveBeenCalled();
  });

  it("explains when there is nothing to analyze", async () => {
    const { d } = deps({
      download: vi.fn(async () => ({ ok: true as const, bytes: tarGz({ "README.md": "# hi\n" }) })),
    });
    await runPipeline(d);

    expect(d.fail).toHaveBeenCalledWith(expect.stringMatching(/no JavaScript or TypeScript/i));
  });

  it("never exposes an internal error message", async () => {
    const { d } = deps({
      save: vi.fn(async () => {
        throw new Error("connection to secret-host:5432 failed");
      }),
    });
    await runPipeline(d);

    expect(d.fail).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(d.fail).mock.calls)).not.toContain("secret-host");
    expect(d.complete).not.toHaveBeenCalled();
  });
});

describe("runPipeline with snapshots", () => {
  const commitSha = "b".repeat(40);
  const files = { "a.ts": 'import "./b";\n', "b.ts": "export const b = 1;\n" };
  const bytes = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  );

  function snapshots(previous: Snapshot | null): SnapshotDeps & { kept: Snapshot[] } {
    const kept: Snapshot[] = [];
    return {
      kept,
      commitSha,
      previous: vi.fn(async () => previous),
      keep: vi.fn(async (snapshot: Snapshot) => {
        kept.push(snapshot);
      }),
      tree: vi.fn(async () => ({
        ok: true as const,
        entries: 2,
        files: Object.entries(bytes).map(([path, b]) => ({ path, sha: blobSha(b), size: b.length })),
      })),
      blob: vi.fn(async (sha: string) => {
        const found = Object.values(bytes).find((b) => blobSha(b) === sha);
        return found ? { ok: true as const, bytes: found } : { ok: false as const, error: "not_found" as const };
      }),
    };
  }

  async function firstSnapshot() {
    const s = snapshots(null);
    const { d } = deps({ snapshots: s });
    await runPipeline(d);
    return s.kept[0]!;
  }

  it("reads the archive the first time, and keeps a snapshot for next time", async () => {
    const s = snapshots(null);
    const { d } = deps({ snapshots: s });
    await runPipeline(d);

    expect(d.download).toHaveBeenCalledOnce();
    expect(s.kept[0]).toMatchObject({ commitSha, sources: [{ path: "a.ts" }, { path: "b.ts" }] });
    expect(vi.mocked(d.complete).mock.calls[0]?.[0]).not.toHaveProperty("incremental");
  });

  it("starts from the last snapshot without downloading the archive", async () => {
    const previous = { ...(await firstSnapshot()), commitSha: "a".repeat(40) };
    const s = snapshots(previous);
    const { d, statuses } = deps({ snapshots: s });
    await runPipeline(d);

    expect(d.download).not.toHaveBeenCalled();
    expect(s.blob).not.toHaveBeenCalled();
    expect(statuses).toEqual(["fetching", "saving"]);
    expect(vi.mocked(d.complete).mock.calls[0]?.[0]).toMatchObject({
      incremental: { from: "a".repeat(40), parsed: 0, reused: 2 },
      totals: { sourceFiles: 2, internalDependencies: 1 },
    });
    expect(s.kept[0]?.commitSha).toBe(commitSha);
  });

  it("falls back to the archive when the snapshot can't be used", async () => {
    const previous = { ...(await firstSnapshot()), commitSha: "a".repeat(40) };
    const s = snapshots(previous);
    s.tree = vi.fn(async () => ({ ok: false as const, error: "upstream" as const }));
    const { d } = deps({ snapshots: s });
    await runPipeline(d);

    expect(d.download).toHaveBeenCalledOnce();
    expect(d.complete).toHaveBeenCalledOnce();
  });

  it("falls back to the archive when loading the snapshot throws", async () => {
    const s = snapshots(null);
    s.previous = vi.fn(async () => {
      throw new Error("database down");
    });
    const { d } = deps({ snapshots: s });
    await runPipeline(d);

    expect(d.download).toHaveBeenCalledOnce();
    expect(d.complete).toHaveBeenCalledOnce();
  });

  it("still completes when the snapshot can't be kept", async () => {
    const s = snapshots(null);
    s.keep = vi.fn(async () => {
      throw new Error("database down");
    });
    const { d } = deps({ snapshots: s });
    await runPipeline(d);

    expect(d.complete).toHaveBeenCalledOnce();
    expect(d.fail).not.toHaveBeenCalled();
  });
});
