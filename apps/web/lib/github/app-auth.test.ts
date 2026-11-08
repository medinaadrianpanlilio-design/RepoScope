import { createVerify, generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appCredentials,
  createAppJwt,
  InstallationToken,
  requestInstallationToken,
  statusChange,
  tokenSource,
  type TokenResult,
} from "./app-auth";

// GitHub hands out PKCS#1 keys, so the test key has the same shape.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const credentials = { clientId: "Iv1.test", privateKey };
const SECRET_TOKEN = "ghs_thisMustNeverBeShown";
const NOW = Date.parse("2026-11-08T00:00:00Z");
const IN_AN_HOUR = new Date(NOW + 3_600_000).toISOString();

const granted = {
  token: SECRET_TOKEN,
  expires_at: IN_AN_HOUR,
  permissions: { contents: "read", metadata: "read" },
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers }));
}

function request(fetchImpl: typeof fetch, repositoryIds?: number[]) {
  return requestInstallationToken(credentials, 42, { fetchImpl, repositoryIds });
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAppJwt", () => {
  it("signs a token GitHub can verify", () => {
    const [header, payload, signature] = createAppJwt(credentials, NOW).split(".") as [
      string,
      string,
      string,
    ];

    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const verifier = createVerify("RSA-SHA256").update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, signature, "base64url")).toBe(true);
  });

  it("names the App and stays inside GitHub's ten minute limit", () => {
    const { iss, iat, exp } = decode(createAppJwt(credentials, NOW).split(".")[1]!);

    expect(iss).toBe("Iv1.test");
    expect(iat).toBe(NOW / 1000 - 60); // Allows for a clock that runs slightly behind GitHub's.
    expect(exp - iat).toBeLessThanOrEqual(600);
  });
});

describe("appCredentials", () => {
  it("reads the two values it needs", () => {
    const env = { GITHUB_APP_CLIENT_ID: "Iv1.test", GITHUB_APP_PRIVATE_KEY: privateKey };
    expect(appCredentials(env)).toEqual(credentials);
  });

  it("accepts a key pasted with its line breaks escaped", () => {
    const pasted = privateKey.replace(/\n/g, "\\n");
    const env = { GITHUB_APP_CLIENT_ID: "Iv1.test", GITHUB_APP_PRIVATE_KEY: pasted };
    expect(appCredentials(env)?.privateKey).toBe(privateKey);
  });

  it("is empty when the App isn't set up", () => {
    expect(appCredentials({ GITHUB_APP_CLIENT_ID: "Iv1.test" })).toBeNull();
    expect(appCredentials({ GITHUB_APP_PRIVATE_KEY: privateKey })).toBeNull();
  });
});

describe("requestInstallationToken", () => {
  it("asks for read access only, as the App", async () => {
    const fetchImpl = respond(201, granted);
    await request(fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(init?.body as string)).toEqual({
      permissions: { contents: "read", metadata: "read" },
    });
  });

  it("can narrow a token to chosen repositories", async () => {
    const fetchImpl = respond(201, granted);
    await request(fetchImpl, [7]);

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string);
    expect(body.repository_ids).toEqual([7]);
  });

  it("returns the token and when it expires", async () => {
    const result = await request(respond(201, granted));

    if (!result.ok) throw new Error(result.error);
    expect(result.token.reveal()).toBe(SECRET_TOKEN);
    expect(result.token.expiresAt).toBe(Date.parse(IN_AN_HOUR));
  });

  it.each([
    ["a removed installation", 404, { message: "Not Found" }, "revoked"],
    ["an App GitHub doesn't know", 404, { message: "Integration not found" }, "not_configured"],
    ["a 404 it can't explain", 404, {}, "upstream"],
    ["a suspended installation", 403, { message: "This installation has been suspended" }, "suspended"],
    ["a permission the owner hasn't accepted", 422, { message: "The permissions requested are not granted to this installation." }, "under_permissioned"],
    ["a repository outside the installation", 422, { message: "There is at least one repository that does not exist or is not accessible to the parent installation." }, "no_access"],
    ["a rejected App key", 401, { message: "A JSON web token could not be decoded" }, "not_configured"],
    ["any other refusal", 403, { message: "Forbidden" }, "upstream"],
    ["a server error", 500, { message: "Oops" }, "upstream"],
  ])("reports %s", async (_name, status, body, error) => {
    expect(await request(respond(status, body))).toMatchObject({ ok: false, error });
  });

  it("reports a rate limit with its reset time", async () => {
    const headers = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" };
    expect(await request(respond(403, { message: "API rate limit exceeded" }, headers))).toEqual({
      ok: false,
      error: "rate_limited",
      resetAt: new Date(1_800_000_000_000).toISOString(),
    });
  });

  it("refuses a token that isn't exactly read access", async () => {
    const write = { ...granted, permissions: { contents: "write", metadata: "read" } };
    const missing = { ...granted, permissions: { metadata: "read" } };

    expect(await request(respond(201, write))).toMatchObject({ error: "under_permissioned" });
    expect(await request(respond(201, missing))).toMatchObject({ error: "under_permissioned" });
  });

  it("treats a malformed answer as a GitHub problem", async () => {
    expect(await request(respond(201, { token: 5 }))).toMatchObject({ error: "upstream" });
    const badDate = { ...granted, expires_at: "soon" };
    expect(await request(respond(201, badDate))).toMatchObject({ error: "upstream" });
  });

  it("survives the network failing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("socket hang up");
    });
    expect(await request(fetchImpl)).toEqual({ ok: false, error: "upstream" });
  });

  it("reports a broken private key without calling GitHub", async () => {
    const fetchImpl = respond(201, granted);
    const broken = { clientId: "Iv1.test", privateKey: "not a key" };

    expect(await requestInstallationToken(broken, 42, { fetchImpl })).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("keeping secrets out of sight", () => {
  const token = new InstallationToken(SECRET_TOKEN, NOW);

  it("hides the token from JSON, so a response can't carry it", () => {
    expect(JSON.stringify({ token })).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify({ result: { ok: true, token } })).toContain("[redacted]");
  });

  it("hides the token from strings and inspection, so a log can't carry it", () => {
    expect(String(token)).toBe("[redacted]");
    expect(`${token}`).toBe("[redacted]");
    expect(inspect(token)).toBe("[redacted]");
    expect(inspect({ nested: { token } }, { depth: 5 })).not.toContain(SECRET_TOKEN);
  });

  it("leaves no enumerable copy of the token", () => {
    expect(Object.values(token)).not.toContain(SECRET_TOKEN);
    expect({ ...token }).not.toHaveProperty("value");
  });

  it("logs nothing, whatever GitHub answers", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );

    await request(respond(201, granted));
    await request(respond(403, { message: "This installation has been suspended" }));
    await request(respond(500, { message: SECRET_TOKEN }));
    await requestInstallationToken({ clientId: "x", privateKey: "bad" }, 42);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("never puts GitHub's words or the App's secrets into a failure", async () => {
    const failed = await request(respond(500, { message: SECRET_TOKEN }));
    expect(JSON.stringify(failed)).toBe('{"ok":false,"error":"upstream"}');

    const broken = await requestInstallationToken({ clientId: "x", privateKey: "bad-key" }, 42);
    expect(JSON.stringify(broken)).not.toContain("bad-key");
  });

  it("keeps the real token out of every route and page", () => {
    const files = (readdirSync("app", { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => join("app", file));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toContain(".reveal(");
  });

  it("can't be bundled for the browser", () => {
    const server = readFileSync("lib/github/installation-tokens.ts", "utf8");
    expect(server).toMatch(/^import "server-only";/);
  });
});

describe("tokenSource", () => {
  const issued = (expiresAt: number): TokenResult => ({
    ok: true,
    token: new InstallationToken(SECRET_TOKEN, expiresAt),
  });

  it("reuses a token that still has time left", async () => {
    const fresh = vi.fn(async () => issued(NOW + 3_600_000));
    const token = tokenSource(fresh, () => NOW);

    await token();
    await token();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("gets a new token before the old one expires", async () => {
    let now = NOW;
    const fresh = vi.fn(async () => issued(NOW + 3_600_000));
    const token = tokenSource(fresh, () => now);

    await token();
    now = NOW + 3_600_000 - 60_000;
    await token();
    expect(fresh).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failure", async () => {
    const fresh = vi
      .fn<() => Promise<TokenResult>>()
      .mockResolvedValueOnce({ ok: false, error: "upstream" })
      .mockResolvedValueOnce(issued(NOW + 3_600_000));
    const token = tokenSource(fresh, () => NOW);

    expect((await token()).ok).toBe(false);
    expect((await token()).ok).toBe(true);
  });
});

describe("statusChange", () => {
  const active = { suspended_at: null, revoked_at: null };
  const suspended = { suspended_at: "2026-11-01T00:00:00Z", revoked_at: null };
  const stamp = new Date(NOW).toISOString();
  const ok: TokenResult = { ok: true, token: new InstallationToken(SECRET_TOKEN, NOW) };

  it("records a removed installation", () => {
    expect(statusChange(active, { ok: false, error: "revoked" }, NOW)).toEqual({ revoked_at: stamp });
  });

  it("records a suspension once", () => {
    const failure: TokenResult = { ok: false, error: "suspended" };
    expect(statusChange(active, failure, NOW)).toEqual({ suspended_at: stamp });
    expect(statusChange(suspended, failure, NOW)).toBeNull();
  });

  it("clears a suspension when GitHub issues a token again", () => {
    expect(statusChange(suspended, ok, NOW)).toEqual({ suspended_at: null });
  });

  it("changes nothing otherwise", () => {
    expect(statusChange(active, ok, NOW)).toBeNull();
    expect(statusChange(active, { ok: false, error: "upstream" }, NOW)).toBeNull();
  });
});
