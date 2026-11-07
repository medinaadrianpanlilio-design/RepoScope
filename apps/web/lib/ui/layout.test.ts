import { describe, expect, it } from "vitest";
import { clamp, nextIndex, readStoredWidth, resizedWidth } from "./layout";

describe("clamp", () => {
  it("keeps a value inside its range", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
  });
});

describe("readStoredWidth", () => {
  it("uses a saved width", () => {
    expect(readStoredWidth("300", 280, 200, 500)).toBe(300);
  });

  it("keeps a saved width inside the limits", () => {
    expect(readStoredWidth("9000", 280, 200, 500)).toBe(500);
  });

  it.each([[null], [""], ["wide"], ["NaN"], ["Infinity"]])("falls back on %s", (raw) => {
    expect(readStoredWidth(raw, 280, 200, 500)).toBe(280);
  });
});

describe("resizedWidth", () => {
  const limits = { min: 200, max: 500 };

  it("grows a left panel when dragged right", () => {
    expect(resizedWidth(300, 40, "left", limits)).toBe(340);
  });

  it("grows a right panel when dragged left", () => {
    expect(resizedWidth(300, -40, "right", limits)).toBe(340);
  });

  it("stops at the limits", () => {
    expect(resizedWidth(300, 9000, "left", limits)).toBe(500);
    expect(resizedWidth(300, 9000, "right", limits)).toBe(200);
  });
});

describe("nextIndex", () => {
  it("moves through a list and wraps at both ends", () => {
    expect(nextIndex(0, 1, 3)).toBe(1);
    expect(nextIndex(2, 1, 3)).toBe(0);
    expect(nextIndex(0, -1, 3)).toBe(2);
  });

  it("stays put in an empty list", () => {
    expect(nextIndex(0, 1, 0)).toBe(0);
  });
});
