import { describe, expect, it } from "vitest";
import { clientIp, rateLimitKey } from "./rate-limit-key";

describe("clientIp", () => {
  it("uses the first forwarded address, which the platform sets", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to the real-ip header", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
  });

  it("groups requests with no address together", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("rateLimitKey", () => {
  it("never contains the raw address", () => {
    expect(rateLimitKey("import", "203.0.113.7")).not.toContain("203.0.113.7");
  });

  it("is stable per action and address", () => {
    const key = rateLimitKey("import", "203.0.113.7");

    expect(rateLimitKey("import", "203.0.113.7")).toBe(key);
    expect(rateLimitKey("analyze", "203.0.113.7")).not.toBe(key);
    expect(rateLimitKey("import", "203.0.113.8")).not.toBe(key);
  });
});
