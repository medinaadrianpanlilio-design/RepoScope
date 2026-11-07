import { describe, expect, it } from "vitest";
import { bearerToken, generateKey, hashKey, kindOfKey } from "./keys";

describe("generateKey", () => {
  it("makes long, distinct keys that show their kind", () => {
    const a = generateKey("mcp");
    const b = generateKey("mcp");

    expect(a.key).toMatch(/^rs_mcp_[\w-]{40,}$/);
    expect(generateKey("sync").key).toMatch(/^rs_sync_/);
    expect(a.key).not.toBe(b.key);
  });

  it("stores a hash, and a prefix too short to use", () => {
    const { key, hash, prefix } = generateKey("sync");

    expect(hash).toBe(hashKey(key));
    expect(hash).not.toContain(key);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(16);
  });
});

describe("kindOfKey", () => {
  it("reads the kind", () => {
    expect(kindOfKey("rs_mcp_abc")).toBe("mcp");
    expect(kindOfKey("rs_sync_abc")).toBe("sync");
  });

  it.each(["", "abc", "rs_admin_abc", "rs_mcp"])("refuses %s", (key) => {
    expect(kindOfKey(key)).toBeNull();
  });
});

describe("bearerToken", () => {
  it("reads a bearer token", () => {
    expect(bearerToken("Bearer rs_sync_abc")).toBe("rs_sync_abc");
  });

  it.each([[null], [""], ["Basic abc"], ["Bearer"], ["Bearer "]])("refuses %s", (header) => {
    expect(bearerToken(header)).toBeNull();
  });
});
