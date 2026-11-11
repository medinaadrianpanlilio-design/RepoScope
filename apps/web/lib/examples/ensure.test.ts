import { describe, expect, it, vi } from "vitest";
import type { RepositoryMetadata } from "@/lib/github/client";
import type { RepositoryReader } from "@/lib/github/reader";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/start", () => ({ startAnalysis: vi.fn() }));
vi.mock("@/lib/repositories/queries", () => ({ upsertRepository: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { ensureExamples } = await import("./ensure");
const { EXAMPLES, fullNameOf } = await import("./list");

const metadata = (owner: string, name: string, isPrivate = false): RepositoryMetadata => ({
  githubId: 1,
  owner,
  name,
  fullName: `${owner}/${name}`,
  githubUrl: `https://github.com/${owner}/${name}`,
  description: null,
  defaultBranch: "main",
  primaryLanguage: "TypeScript",
  isPrivate,
});

function deps(overrides: Partial<Parameters<typeof ensureExamples>[0]> = {}) {
  const reader = {
    latestCommit: vi.fn(async () => ({ ok: true as const, sha: "a".repeat(40) })),
  } as unknown as RepositoryReader;
  return {
    lookup: vi.fn(async (example: { owner: string; name: string }) => ({
      ok: true as const,
      repository: metadata(example.owner, example.name),
    })),
    upsert: vi.fn(async (repository: RepositoryMetadata) => `id-${repository.name}`),
    hasResults: vi.fn(async () => false),
    reader: vi.fn(() => reader),
    start: vi.fn(async () => ({ start: true })),
    ...overrides,
  };
}

const first = fullNameOf(EXAMPLES[0]);

describe("ensureExamples", () => {
  it("analyzes every example that has no results yet", async () => {
    const d = deps();
    const outcomes = await ensureExamples(d);
    expect(Object.values(outcomes).every((o) => o === "started")).toBe(true);
    expect(d.start).toHaveBeenCalledTimes(EXAMPLES.length);
  });

  it("leaves an example with results alone, but still refreshes its record", async () => {
    const d = deps({ hasResults: vi.fn(async () => true) });
    expect((await ensureExamples(d))[first]).toBe("ready");
    expect(d.upsert).toHaveBeenCalledTimes(EXAMPLES.length);
    expect(d.start).not.toHaveBeenCalled();
  });

  it("says so when an analysis is already running", async () => {
    expect((await ensureExamples(deps({ start: vi.fn(async () => ({ start: false })) })))[first]).toBe(
      "running",
    );
  });

  it("never stores an example that turned private", async () => {
    const d = deps({
      lookup: vi.fn(async (example: { owner: string; name: string }) => ({
        ok: true as const,
        repository: metadata(example.owner, example.name, true),
      })),
    });
    expect((await ensureExamples(d))[first]).toBe("unavailable");
    expect(d.upsert).not.toHaveBeenCalled();
  });

  it("keeps going when one example fails", async () => {
    const lookup = vi.fn(async (example: { owner: string; name: string }) => {
      if (`${example.owner}/${example.name}` === first) throw new Error("boom");
      return { ok: true as const, repository: metadata(example.owner, example.name) };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcomes = await ensureExamples(deps({ lookup }));
    expect(outcomes[first]).toBe("unavailable");
    expect(Object.values(outcomes).filter((o) => o === "started")).toHaveLength(EXAMPLES.length - 1);
  });
});
