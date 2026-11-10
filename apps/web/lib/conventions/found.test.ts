import { describe, expect, it, vi } from "vitest";
import { FOUND_PATHS, foundPaths, namedOnly, readFoundConventions } from "./found";

describe("foundPaths", () => {
  it("only asks for files the analysis saw", () => {
    expect(foundPaths(["README.md", "AGENTS.md", "docs/CONTRIBUTING.md", "src/AGENTS.md"], 4)).toEqual([
      "AGENTS.md",
      "docs/CONTRIBUTING.md",
    ]);
  });

  it("tries every path when the file list is missing or was cut short", () => {
    expect(foundPaths(null, 0)).toEqual(FOUND_PATHS);
    expect(foundPaths(["README.md"], 9000)).toEqual(FOUND_PATHS);
  });
});

describe("readFoundConventions", () => {
  const github = { owner: "o", name: "r", commitSha: "a".repeat(40), source: "github" };

  it("returns what it could read, and skips files that don't exist", async () => {
    const read = vi.fn(async (path: string) =>
      path === "AGENTS.md"
        ? ({ ok: true, content: "# Rules" } as const)
        : ({ ok: false, error: "not_found" } as const),
    );
    expect(await readFoundConventions(github, ["AGENTS.md", "CLAUDE.md"], read)).toEqual([
      { path: "AGENTS.md", content: "# Rules" },
    ]);
  });

  it("says why a file couldn't be shown", async () => {
    const found = await readFoundConventions(github, ["AGENTS.md", "CLAUDE.md"], async (path) => ({
      ok: false,
      error: path === "AGENTS.md" ? "too_large" : "upstream",
    }));
    expect(found.map((f) => f.note)).toEqual([
      "This file is too large to show.",
      "We couldn't read this file from GitHub.",
    ]);
  });

  it("never reaches for a local folder's files", async () => {
    const read = vi.fn();
    const found = await readFoundConventions({ ...github, source: "local" }, ["AGENTS.md"], read);
    expect(read).not.toHaveBeenCalled();
    expect(found).toEqual([{ path: "AGENTS.md", content: null, note: "This file stays on your computer." }]);
  });
});

describe("namedOnly", () => {
  it("names each file with a note and no content", () => {
    expect(namedOnly(["AGENTS.md", "CLAUDE.md"], "Private.")).toEqual([
      { path: "AGENTS.md", content: null, note: "Private." },
      { path: "CLAUDE.md", content: null, note: "Private." },
    ]);
  });
});
