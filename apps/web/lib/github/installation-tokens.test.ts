import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  filters: [] as [string, unknown][],
  updates: [] as Record<string, unknown>[],
  row: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      from: () => chain,
      select: () => chain,
      update: (fields: Record<string, unknown>) => {
        db.updates.push(fields);
        return chain;
      },
      eq: (column: string, value: unknown) => {
        db.filters.push([column, value]);
        return chain;
      },
      maybeSingle: async () => ({ data: db.row, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ error: null }),
    };
    return chain;
  },
}));

import { installationOf, openTokenSource } from "./installation-tokens";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const active = {
  id: "installation",
  github_installation_id: 42,
  suspended_at: null,
  revoked_at: null,
  verified_repository_ids: [],
};

const github = vi.fn<typeof fetch>();

beforeEach(() => {
  db.filters = [];
  db.updates = [];
  db.row = null;
  github.mockReset();
  vi.stubGlobal("fetch", github);
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.test");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("installationOf", () => {
  it("only looks among the user's own installations", async () => {
    db.row = active;
    expect(await installationOf("me", "installation")).toBe(active);
    expect(db.filters).toContainEqual(["user_id", "me"]);
    expect(db.filters).toContainEqual(["id", "installation"]);
  });

  it("finds nothing for someone else's", async () => {
    expect(await installationOf("them", "installation")).toBeNull();
  });
});

describe("openTokenSource", () => {
  it("doesn't ask GitHub about an installation already removed", async () => {
    const token = openTokenSource({ ...active, revoked_at: "2026-11-01T00:00:00Z" });

    expect(await token()).toEqual({ ok: false, error: "revoked" });
    expect(github).not.toHaveBeenCalled();
  });

  it("says when the App isn't set up", async () => {
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");

    expect(await openTokenSource(active)()).toEqual({ ok: false, error: "not_configured" });
    expect(github).not.toHaveBeenCalled();
  });

  it("records an installation GitHub no longer knows", async () => {
    const gone = JSON.stringify({ message: "Not Found" });
    github.mockResolvedValue(new Response(gone, { status: 404 }));

    expect(await openTokenSource(active)()).toEqual({ ok: false, error: "revoked" });
    expect(db.updates[0]).toHaveProperty("revoked_at");
    expect(db.filters).toContainEqual(["id", "installation"]);
  });

  it("doesn't blame the installation for a wrong App id", async () => {
    const unknown = JSON.stringify({ message: "Integration not found" });
    github.mockResolvedValue(new Response(unknown, { status: 404 }));

    expect(await openTokenSource(active)()).toEqual({ ok: false, error: "not_configured" });
    expect(db.updates).toEqual([]);
  });

  it("writes nothing for a healthy installation", async () => {
    const body = {
      token: "ghs_test",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      permissions: { contents: "read", metadata: "read" },
    };
    github.mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));

    expect((await openTokenSource(active)()).ok).toBe(true);
    expect(db.updates).toEqual([]);
  });
});
