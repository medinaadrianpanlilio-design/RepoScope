import { describe, expect, it } from "vitest";
import { analysisLabel, isActive, languageShares, progressSteps, shortSha } from "./present";

describe("isActive", () => {
  it.each(["queued", "fetching", "scanning", "parsing", "saving"])("treats %s as running", (status) => {
    expect(isActive(status)).toBe(true);
  });

  it.each(["completed", "failed"])("treats %s as finished", (status) => {
    expect(isActive(status)).toBe(false);
  });
});

describe("progressSteps", () => {
  it("marks earlier steps done, the current one active and later ones waiting", () => {
    expect(progressSteps("parsing").map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "active",
      "waiting",
    ]);
  });

  it("starts with nothing done", () => {
    expect(progressSteps("queued")[0]?.state).toBe("active");
  });

  it("never claims a step is done for an unknown status", () => {
    expect(progressSteps("mystery").every((step) => step.state === "waiting")).toBe(true);
  });
});

describe("analysisLabel", () => {
  const run = { status: "completed", completedAt: "2026-11-07T04:00:00Z" };

  it("says when there is no analysis", () => {
    expect(analysisLabel(null)).toBe("Not analyzed yet");
  });

  it("gives the analysis date", () => {
    expect(analysisLabel(run)).toBe("Analyzed Nov 7, 2026");
  });

  it("reports failures and running analyses", () => {
    expect(analysisLabel({ status: "failed", completedAt: null })).toBe("Analysis failed");
    expect(analysisLabel({ status: "parsing", completedAt: null })).toBe("Analysis in progress");
  });
});

describe("languageShares", () => {
  it("gives each language its share of lines", () => {
    expect(
      languageShares([
        { language: "TypeScript", files: 3, lines: 75 },
        { language: "JavaScript", files: 1, lines: 25 },
      ]),
    ).toEqual([
      { language: "TypeScript", files: 3, lines: 75, percent: 75 },
      { language: "JavaScript", files: 1, lines: 25, percent: 25 },
    ]);
  });

  it("handles a repository of empty files", () => {
    expect(languageShares([{ language: "TypeScript", files: 1, lines: 0 }])[0]?.percent).toBe(0);
  });
});

describe("shortSha", () => {
  it("shortens a commit hash", () => {
    expect(shortSha("54b9e7133c1c17243c9bee79aaabc7cddc2e7b77")).toBe("54b9e71");
  });
});
