import { describe, expect, it } from "vitest";
import { isAuthorizedCron, planCleanup, type CleanupRun } from "./plan";

const now = new Date("2026-11-07T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

function run(id: string, overrides: Partial<CleanupRun> = {}): CleanupRun {
  return {
    id,
    repository_id: "repo",
    status: "completed",
    error_message: null,
    created_at: daysAgo(1),
    started_at: daysAgo(1),
    completed_at: daysAgo(1),
    ...overrides,
  };
}

const plan = (input: Partial<Parameters<typeof planCleanup>[0]>) =>
  planCleanup({ repositories: [], savedRepositoryIds: new Set(), runs: [], ...input }, now);

describe("trimming old analyses", () => {
  const runs = Array.from({ length: 7 }, (_, i) =>
    run(`run-${i}`, { completed_at: daysAgo(i + 1) }),
  );

  it("keeps full data for the latest 5 and trims older ones", () => {
    expect(plan({ runs }).trimRunIds).toEqual(["run-5", "run-6"]);
  });

  it("trims nothing at the limit", () => {
    expect(plan({ runs: runs.slice(0, 5) }).trimRunIds).toEqual([]);
  });

  it("counts each repository separately", () => {
    const other = runs.slice(0, 4).map((r) => ({ ...r, id: `o-${r.id}`, repository_id: "other" }));
    const result = plan({ runs: [...runs.slice(0, 4), ...other] });

    expect(result.trimRunIds).toEqual([]);
  });

  it("ignores failed runs when counting", () => {
    const failed = run("failed", { status: "failed", completed_at: null });

    expect(plan({ runs: [...runs.slice(0, 5), failed] }).trimRunIds).toEqual([]);
  });
});

describe("deleting unsaved repositories", () => {
  const old = { id: "old", updated_at: daysAgo(31), full_name: "someone/app", owner_user_id: null };
  const oldRun = run("r", { repository_id: "old", created_at: daysAgo(31), completed_at: daysAgo(31) });

  it("deletes a repository nobody saved after 30 days", () => {
    expect(plan({ repositories: [old], runs: [oldRun] }).deleteRepositoryIds).toEqual(["old"]);
  });

  it("keeps a saved repository forever", () => {
    expect(
      plan({ repositories: [old], runs: [oldRun], savedRepositoryIds: new Set(["old"]) })
        .deleteRepositoryIds,
    ).toEqual([]);
  });

  it("keeps a repository imported recently", () => {
    expect(
      plan({ repositories: [{ ...old, updated_at: daysAgo(29) }], runs: [oldRun] })
        .deleteRepositoryIds,
    ).toEqual([]);
  });

  it("keeps a repository analyzed recently", () => {
    const recent = run("new", { repository_id: "old", created_at: daysAgo(2) });

    expect(plan({ repositories: [old], runs: [oldRun, recent] }).deleteRepositoryIds).toEqual([]);
  });

  it("deletes an old repository that was never analyzed", () => {
    expect(plan({ repositories: [old] }).deleteRepositoryIds).toEqual(["old"]);
  });

  it("doesn't also trim a repository it deletes", () => {
    const runs = Array.from({ length: 7 }, (_, i) =>
      run(`x-${i}`, { repository_id: "old", created_at: daysAgo(40), completed_at: daysAgo(40 + i) }),
    );

    expect(plan({ repositories: [old], runs }).trimRunIds).toEqual([]);
  });

  it("keeps an example repository nobody saved, in any case", () => {
    const example = { ...old, full_name: "Vercel/MS" };
    expect(plan({ repositories: [example], runs: [oldRun] }).deleteRepositoryIds).toEqual([]);
  });

  it("still deletes someone's own copy that shares an example's name", () => {
    const copy = { ...old, full_name: "vercel/ms", owner_user_id: "user" };
    expect(plan({ repositories: [copy], runs: [oldRun] }).deleteRepositoryIds).toEqual(["old"]);
  });
});

describe("stuck runs", () => {
  it("closes a run that was killed partway through", () => {
    const stuck = run("stuck", { status: "parsing", started_at: daysAgo(1), completed_at: null });

    expect(plan({ runs: [stuck] }).failRunIds).toEqual(["stuck"]);
  });

  it("leaves a healthy run alone", () => {
    const active = run("active", {
      status: "parsing",
      started_at: new Date(now.getTime() - 60_000).toISOString(),
      completed_at: null,
    });

    expect(plan({ runs: [active] }).failRunIds).toEqual([]);
  });
});

describe("isAuthorizedCron", () => {
  it("accepts the exact secret", () => {
    expect(isAuthorizedCron("Bearer right-secret", "right-secret")).toBe(true);
  });

  it.each([
    ["no header", null],
    ["wrong secret", "Bearer wrong-secret!"],
    ["no scheme", "right-secret"],
    ["a longer value", "Bearer right-secret-and-more"],
  ])("refuses %s", (_label, header) => {
    expect(isAuthorizedCron(header, "right-secret")).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
});
