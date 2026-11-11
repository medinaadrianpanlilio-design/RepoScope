import { describe, expect, it } from "vitest";
import { chunk, mapLimit, pageStarts } from "./concurrency";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapLimit", () => {
  it("keeps input order, whatever order tasks finish in", async () => {
    const result = await mapLimit([30, 10, 20], 3, async (ms) => {
      await wait(ms);
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running++;
      most = Math.max(most, running);
      await wait(5);
      running--;
    });
    expect(most).toBe(3);
  });

  it("rejects on the first failure and starts nothing after it", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3, 4], 1, async (i) => {
        started.push(i);
        if (i === 1) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
  });

  it("handles nothing to do", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into pieces no bigger than the size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("pageStarts", () => {
  it("starts a page every `size` rows", () => {
    expect(pageStarts(2500, 1000)).toEqual([0, 1000, 2000]);
    expect(pageStarts(1000, 1000)).toEqual([0]);
  });

  it("always reads one page, so an empty table still answers", () => {
    expect(pageStarts(0, 1000)).toEqual([0]);
  });
});
