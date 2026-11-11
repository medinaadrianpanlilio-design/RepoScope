import { describe, expect, it } from "vitest";
import { clusterKeys, clusterOrder } from "./clusters";

const file = (id: number, path: string) => ({ id, path, language: "TypeScript", lines: 1, incoming: 0, outgoing: 0 });

describe("clusterKeys", () => {
  it("groups by top-level folder", () => {
    const keys = clusterKeys([file(1, "src/a.ts"), file(2, "tests/a.test.ts"), file(3, "index.ts")]);
    expect([...keys.values()]).toEqual(["src", "tests", "(root)"]);
  });

  it("looks one level deeper inside a folder that holds most files", () => {
    const keys = clusterKeys([
      file(1, "src/middleware/a.ts"),
      file(2, "src/middleware/b.ts"),
      file(3, "src/react.ts"),
      file(4, "tests/a.test.ts"),
    ]);
    expect([...keys.values()]).toEqual(["src/middleware", "src/middleware", "src", "tests"]);
  });
});

describe("clusterOrder", () => {
  it("puts the biggest cluster first", () => {
    const keys = new Map([
      [1, "tests"],
      [2, "src"],
      [3, "src"],
    ]);
    expect(clusterOrder(keys)).toEqual(["src", "tests"]);
  });
});
