import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./app-auth";
import {
  authorizeUrl,
  callbackStep,
  connectMessage,
  CONNECT_CODES,
  exchangeCode,
  installationRepositories,
  installUrl,
  linkDecision,
  newState,
  oauthCredentials,
  revokeUserToken,
  sameState,
  summarizeLinks,
  userInstallations,
  userRepositoryIds,
} from "./connect";

const oauth = { clientId: "Iv1.test", clientSecret: "client-secret-value", slug: "reposcope-test" };
const USER_TOKEN = "ghu_thisMustNeverBeShown";
const token = new GitHubToken(USER_TOKEN, Date.now() + 3_600_000);

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers }));
}

/** Answers each page in turn, like GitHub's paginated lists. */
function pages(...bodies: unknown[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const body of bodies) {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
  return fetchImpl;
}

const repo = (id: number, isPrivate = true) => ({
  id,
  full_name: `me/repo-${id}`,
  private: isPrivate,
  default_branch: "main",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("oauthCredentials", () => {
  it("needs the client id, client secret and App name", () => {
    const env = {
      GITHUB_APP_CLIENT_ID: "Iv1.test",
      GITHUB_APP_CLIENT_SECRET: "client-secret-value",
      GITHUB_APP_SLUG: "reposcope-test",
    };
    expect(oauthCredentials(env)).toEqual(oauth);
    expect(oauthCredentials({ ...env, GITHUB_APP_SLUG: "" })).toBeNull();
    expect(oauthCredentials({ ...env, GITHUB_APP_CLIENT_SECRET: undefined })).toBeNull();
  });
});

describe("state", () => {
  it("is long, random and URL safe", () => {
    const a = newState();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newState()).not.toBe(a);
  });

  it("matches only exactly", () => {
    const state = newState();
    expect(sameState(state, state)).toBe(true);
    expect(sameState(state, `${state}x`)).toBe(false);
    expect(sameState(state, newState())).toBe(false);
    expect(sameState(state, undefined)).toBe(false);
    expect(sameState(null, state)).toBe(false);
    expect(sameState("", "")).toBe(false);
  });
});

describe("GitHub links", () => {
  it("opens the App's install page", () => {
    expect(installUrl("reposcope-test", "abc")).toBe(
      "https://github.com/apps/reposcope-test/installations/new?state=abc",
    );
  });

  it("asks GitHub who the user is, returning to RepoScope with the state", () => {
    const url = new URL(authorizeUrl("Iv1.test", "abc", "https://example.test/api/github/callback"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv1.test",
      state: "abc",
      redirect_uri: "https://example.test/api/github/callback",
      allow_signup: "false",
    });
  });
});

describe("callbackStep", () => {
  const state = newState();
  // null stands for "nothing saved", because undefined would pick up the default.
  const step = (query: string, saved: string | null = state) =>
    callbackStep(new URLSearchParams(query), saved ?? undefined);

  it("trusts a code only when it carries this browser's state", () => {
    expect(step(`code=abc&state=${state}`)).toEqual({ kind: "exchange", code: "abc" });
  });

  it("calls a wrong or missing saved state forged", () => {
    expect(step(`code=abc&state=${newState()}`)).toEqual({ kind: "forged" });
    expect(step(`code=abc&state=${state}`, null)).toEqual({ kind: "forged" });
  });

  it("checks who the user is when the install page sends no state", () => {
    expect(step("code=abc&installation_id=1&setup_action=install", null)).toEqual({
      kind: "authorize",
    });
    expect(step("installation_id=1&setup_action=update")).toEqual({ kind: "authorize" });
    expect(step("")).toEqual({ kind: "authorize" });
  });

  it("explains an install waiting for an organization owner", () => {
    expect(step("setup_action=request")).toEqual({ kind: "requested" });
  });

  it("treats a declined authorization as cancelled", () => {
    expect(step(`error=access_denied&state=${state}`)).toEqual({ kind: "cancelled" });
    expect(step(`state=${state}`)).toEqual({ kind: "cancelled" });
  });
});

describe("exchangeCode", () => {
  const exchange = (fetchImpl: typeof fetch) =>
    exchangeCode(oauth, "the-code", "https://example.test/api/github/callback", { fetchImpl });

  it("trades the code for a short-lived user token", async () => {
    const fetchImpl = respond(200, { access_token: USER_TOKEN, expires_in: 28_800 });
    const result = await exchange(fetchImpl);

    if (!result.ok) throw new Error(result.error);
    expect(result.token.reveal()).toBe(USER_TOKEN);
    expect(JSON.stringify(result)).not.toContain(USER_TOKEN);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.parse(init?.body as string)).toEqual({
      client_id: "Iv1.test",
      client_secret: "client-secret-value",
      code: "the-code",
      redirect_uri: "https://example.test/api/github/callback",
    });
  });

  it.each([
    ["bad_verification_code", "bad_code"],
    ["incorrect_client_credentials", "not_configured"],
    ["redirect_uri_mismatch", "not_configured"],
    ["something_new", "upstream"],
  ])("maps %s", async (error, expected) => {
    expect(await exchange(respond(200, { error }))).toEqual({ ok: false, error: expected });
  });

  it("blames the setup when GitHub doesn't know the App", async () => {
    // What GitHub really answers for an unknown client id.
    expect(await exchange(respond(404, { error: "Not Found" }))).toEqual({
      ok: false,
      error: "not_configured",
    });
  });

  it("survives a server error and the network failing", async () => {
    expect(await exchange(respond(502, {}))).toEqual({ ok: false, error: "upstream" });
    const down = vi.fn<typeof fetch>(async () => {
      throw new Error("down");
    });
    expect(await exchange(down)).toEqual({ ok: false, error: "upstream" });
  });
});

describe("userInstallations", () => {
  const installation = (id: number, login: string, type = "User") => ({
    id,
    account: { login, type },
    repository_selection: "selected",
    suspended_at: null,
  });

  it("lists the App's installations the user can reach, across pages", async () => {
    const first = Array.from({ length: 100 }, (_, i) => installation(i + 1, `a${i}`));
    const fetchImpl = pages(
      { installations: first },
      { installations: [installation(101, "org", "Organization")] },
    );
    const result = await userInstallations(token, { fetchImpl });

    if (!result.ok) throw new Error(result.error);
    expect(result.items).toHaveLength(101);
    expect(result.items[100]).toEqual({
      githubInstallationId: 101,
      accountLogin: "org",
      accountType: "Organization",
      suspendedAt: null,
    });
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://api.github.com/user/installations?per_page=100&page=2",
    );
    const headers = new Headers(fetchImpl.mock.calls[0]![1]?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${USER_TOKEN}`);
  });

  it("skips account kinds it can't handle", async () => {
    const enterprise = { id: 9, account: { slug: "corp" }, suspended_at: null };
    const result = await userInstallations(token, {
      fetchImpl: pages({ installations: [enterprise, installation(1, "me")] }),
    });
    expect(result.ok && result.items.map((i) => i.githubInstallationId)).toEqual([1]);
  });

  it("reports a rate limit and a failure", async () => {
    const limited = respond(403, {}, { "x-ratelimit-remaining": "0" });
    expect(await userInstallations(token, { fetchImpl: limited })).toMatchObject({
      error: "rate_limited",
    });
    expect(await userInstallations(token, { fetchImpl: respond(500, {}) })).toEqual({
      ok: false,
      error: "upstream",
    });
  });
});

describe("repository lists", () => {
  it("reads what an installation reaches, with its visibility", async () => {
    const result = await installationRepositories(token, {
      fetchImpl: pages({ total_count: 2, repositories: [repo(1), repo(2, false)] }),
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.items).toEqual([
      { githubId: 1, fullName: "me/repo-1", isPrivate: true, defaultBranch: "main" },
      { githubId: 2, fullName: "me/repo-2", isPrivate: false, defaultBranch: "main" },
    ]);
    expect(result.complete).toBe(true);
  });

  it("reads which of an installation's repositories the user can see", async () => {
    const fetchImpl = pages({ repositories: [repo(1), repo(3)] });
    const result = await userRepositoryIds(token, 77, { fetchImpl });

    expect(result).toEqual({ ok: true, items: [1, 3], complete: true });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://api.github.com/user/installations/77/repositories?per_page=100&page=1",
    );
  });

  it("stops at ten pages and says the list is incomplete", async () => {
    const full = { repositories: Array.from({ length: 100 }, (_, i) => repo(i)) };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(full)));
    const result = await installationRepositories(token, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(result.ok && result.complete).toBe(false);
  });
});

describe("linkDecision", () => {
  it("links an installation when the user can see everything it reaches", () => {
    expect(linkDecision([1, 2], [1, 2, 3], true)).toBe("link");
    expect(linkDecision([], [], true)).toBe("link");
  });

  it("refuses one that reaches repositories the user can't see", () => {
    expect(linkDecision([1, 2], [1], true)).toBe("too_broad");
  });

  it("refuses one too large to check", () => {
    expect(linkDecision([1], [1], false)).toBe("too_large");
  });
});

describe("revokeUserToken", () => {
  it("revokes the token as the App, so nothing usable is left behind", async () => {
    const fetchImpl = respond(204, null);
    await revokeUserToken(oauth, token, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/applications/Iv1.test/token");
    expect(init?.method).toBe("DELETE");
    const basic = Buffer.from("Iv1.test:client-secret-value").toString("base64");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${basic}`);
    expect(JSON.parse(init?.body as string)).toEqual({ access_token: USER_TOKEN });
  });

  it("never throws", async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new Error("down");
    });
    await expect(revokeUserToken(oauth, token, { fetchImpl: down })).resolves.toBeUndefined();
  });
});

describe("connectMessage", () => {
  it("has words for every outcome", () => {
    for (const code of CONNECT_CODES) {
      const message = connectMessage(code);
      expect(message?.text.length, code).toBeGreaterThan(10);
    }
  });

  it("ignores anything else in the address bar", () => {
    expect(connectMessage("<script>")).toBeNull();
    expect(connectMessage(undefined)).toBeNull();
  });

  it("logs nothing and leaks no secrets on any failure", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const failed = await exchangeCode(oauth, "c", "https://x.test", {
      fetchImpl: respond(200, { error: "bad_verification_code", detail: USER_TOKEN }),
    });
    await userInstallations(token, { fetchImpl: respond(500, { message: USER_TOKEN }) });

    expect(JSON.stringify(failed)).not.toContain("client-secret-value");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("summarizeLinks", () => {
  it("is connected only when every installation linked", () => {
    expect(summarizeLinks(["linked", "linked"])).toBe("connected");
    expect(summarizeLinks(["linked", "too_broad"])).toBe("partly");
  });

  it("names the one reason nothing linked", () => {
    expect(summarizeLinks(["too_broad"])).toBe("too_broad");
    expect(summarizeLinks(["claimed", "claimed"])).toBe("claimed");
    expect(summarizeLinks(["too_large"])).toBe("too_large");
    expect(summarizeLinks(["rate_limited"])).toBe("rate_limited");
  });

  it("falls back to a general failure for mixed or unknown reasons", () => {
    expect(summarizeLinks(["too_broad", "claimed"])).toBe("failed");
    expect(summarizeLinks(["unavailable"])).toBe("failed");
  });

  it("puts a broken setup first, and says when there was nothing", () => {
    expect(summarizeLinks(["linked", "not_configured"])).toBe("not_configured");
    expect(summarizeLinks([])).toBe("none");
  });
});
