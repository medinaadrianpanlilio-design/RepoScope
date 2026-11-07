import { describe, expect, it, vi } from "vitest";
import { claimRun, displayStatus, isStale, type ClaimDeps, type RunRecord } from "./claim";

const now = new Date("2026-11-07T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    status: "parsing",
    error_message: null,
    created_at: minutesAgo(1),
    started_at: minutesAgo(1),
    ...overrides,
  };
}

function deps(overrides: Partial<ClaimDeps> = {}): ClaimDeps {
  return {
    insert: vi.fn(async () => null),
    find: vi.fn(async () => run()),
    restart: vi.fn(async () => true),
    ...overrides,
  };
}

describe("claimRun", () => {
  it("starts a commit that has never been analyzed", async () => {
    const d = deps({ insert: vi.fn(async () => run({ id: "new", status: "queued" })) });

    expect(await claimRun(d, now)).toMatchObject({ start: true, run: { id: "new" } });
    expect(d.find).not.toHaveBeenCalled();
  });

  it("reuses a completed analysis of the same commit", async () => {
    const d = deps({ find: vi.fn(async () => run({ status: "completed" })) });

    expect(await claimRun(d, now)).toMatchObject({ start: false });
    expect(d.restart).not.toHaveBeenCalled();
  });

  it("joins a run already in progress instead of starting a second one", async () => {
    const d = deps();

    expect(await claimRun(d, now)).toMatchObject({ start: false, run: { id: "run-1" } });
    expect(d.restart).not.toHaveBeenCalled();
  });

  it("retries a failed run", async () => {
    const failed = run({ status: "failed" });
    const d = deps({ find: vi.fn(async () => failed) });

    expect(await claimRun(d, now)).toMatchObject({ start: true });
    expect(d.restart).toHaveBeenCalledWith(failed);
  });

  it("takes over a run that was killed partway through", async () => {
    const stuck = run({ status: "parsing", started_at: minutesAgo(10) });
    const d = deps({ find: vi.fn(async () => stuck) });

    expect(await claimRun(d, now)).toMatchObject({ start: true });
  });

  it("lets only one of two simultaneous retries win", async () => {
    const d = deps({
      find: vi.fn(async () => run({ status: "failed" })),
      restart: vi.fn(async () => false),
    });

    expect(await claimRun(d, now)).toMatchObject({ start: false });
  });
});

describe("isStale", () => {
  it("allows a run the full time limit", () => {
    expect(isStale(run({ started_at: minutesAgo(5) }), now)).toBe(false);
  });

  it("flags a run past the time limit", () => {
    expect(isStale(run({ started_at: minutesAgo(7) }), now)).toBe(true);
  });

  it("falls back to creation time for a queued run", () => {
    expect(isStale(run({ status: "queued", started_at: null, created_at: minutesAgo(7) }), now)).toBe(true);
  });

  it("never flags finished runs", () => {
    expect(isStale(run({ status: "completed", started_at: minutesAgo(99) }), now)).toBe(false);
    expect(isStale(run({ status: "failed", started_at: minutesAgo(99) }), now)).toBe(false);
  });
});

describe("displayStatus", () => {
  it("reports a stuck run as failed instead of running forever", () => {
    expect(displayStatus(run({ started_at: minutesAgo(10) }), now)).toMatchObject({
      status: "failed",
      errorMessage: expect.stringMatching(/time limit/i),
    });
  });

  it("passes other runs through", () => {
    expect(displayStatus(run({ status: "failed", error_message: "x" }), now)).toEqual({
      status: "failed",
      errorMessage: "x",
    });
  });
});
