import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { runPipeline, type PipelineDeps } from "./pipeline";

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
