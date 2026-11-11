import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATE_COOKIE, newState } from "@/lib/github/connect";

vi.mock("server-only", () => ({}));
const user = vi.hoisted(() => ({ current: { id: "user-1", email: "a@example.test" } as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getOptionalUser: async () => user.current }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: async () => true }));
const connectInstallations = vi.hoisted(() => vi.fn(async () => "connected"));
vi.mock("@/lib/github/connections", () => ({ connectInstallations }));
const exchangeCode = vi.hoisted(() => vi.fn());
const revokeUserToken = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/github/connect", async (original) => ({
  ...(await original<typeof import("@/lib/github/connect")>()),
  exchangeCode,
  revokeUserToken,
}));

const { GET } = await import("./route");

function callback(query: string, savedState?: string) {
  const headers = new Headers();
  if (savedState) headers.set("cookie", `${STATE_COOKIE}=${savedState}`);
  return GET(new NextRequest(`https://reposcope.test/api/github/callback?${query}`, { headers }));
}

const landing = (response: Response) => new URL(response.headers.get("location")!);

describe("GET /api/github/callback", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "client-id");
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GITHUB_APP_SLUG", "reposcope");
    user.current = { id: "user-1" };
    connectInstallations.mockClear();
    exchangeCode.mockReset();
    exchangeCode.mockResolvedValue({ ok: true, token: { reveal: () => "user-token" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("links installations for a code that came back with this browser's state", async () => {
    const state = newState();
    const response = await callback(`code=good&state=${state}`, state);
    expect(landing(response).searchParams.get("github")).toBe("connected");
    expect(connectInstallations).toHaveBeenCalledWith("user-1", expect.anything());
    expect(revokeUserToken).toHaveBeenCalled();
  });

  it("ignores a code sent with someone else's state, without exchanging it", async () => {
    const response = await callback(`code=stolen&state=${newState()}`, newState());
    expect(landing(response).searchParams.get("github")).toBe("forged");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(connectInstallations).not.toHaveBeenCalled();
  });

  it("ignores a code when this browser never started connecting", async () => {
    const response = await callback(`code=stolen&state=${newState()}`);
    expect(landing(response).searchParams.get("github")).toBe("forged");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("never trusts an installation_id in the address: it starts a fresh sign-in instead", async () => {
    const response = await callback("installation_id=123456&setup_action=install");
    const next = landing(response);
    expect(next.origin).toBe("https://github.com");
    expect(next.pathname).toBe("/login/oauth/authorize");
    expect(next.searchParams.get("state")).toMatch(/.{20,}/);
    expect(response.headers.get("set-cookie")).toContain(STATE_COOKIE);
    expect(connectInstallations).not.toHaveBeenCalled();
  });

  it("sends someone who isn't signed in to log in, and links nothing", async () => {
    user.current = null;
    const state = newState();
    const response = await callback(`code=good&state=${state}`, state);
    expect(landing(response).pathname).toBe("/login");
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});
