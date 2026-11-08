import { createSign } from "node:crypto";
import { z } from "zod";
import { isRateLimited } from "./client";

const REQUEST_TIMEOUT_MS = 10_000;
const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const EXPIRY_MARGIN_MS = 5 * 60_000;
const REDACTED = "[redacted]";

/** Spec rule: read-only, and nothing beyond these two. */
const PERMISSIONS = { contents: "read", metadata: "read" };

const tokenResponse = z.object({
  token: z.string().min(1),
  expires_at: z.string(),
  permissions: z.record(z.string(), z.string()),
});

export type AppCredentials = { clientId: string; privateKey: string };

export type TokenError =
  | "not_configured"
  | "revoked"
  | "suspended"
  | "under_permissioned"
  | "no_access"
  | "upstream";

export type TokenResult =
  | { ok: true; token: InstallationToken }
  | { ok: false; error: TokenError }
  | { ok: false; error: "rate_limited"; resetAt: string | null };

type InstallationStatus = { suspended_at: string | null; revoked_at: string | null };

/**
 * An installation token that can't be shown by accident: JSON, strings and logs all print a
 * placeholder, and the real value lives in a private field. Tokens are never stored.
 */
export class InstallationToken {
  readonly #value: string;
  readonly expiresAt: number;

  constructor(value: string, expiresAt: number) {
    this.#value = value;
    this.expiresAt = expiresAt;
  }

  /** Only for the Authorization header of a request to GitHub. */
  reveal(): string {
    return this.#value;
  }

  toJSON() {
    return REDACTED;
  }

  toString() {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return REDACTED;
  }
}

export function appCredentials(env: Record<string, string | undefined>): AppCredentials | null {
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!clientId || !privateKey) return null;
  return { clientId, privateKey: privateKey.replace(/\\n/g, "\n") };
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Proves a request comes from the App. It can only ask for installation tokens. */
export function createAppJwt({ clientId, privateKey }: AppCredentials, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - JWT_BACKDATE_SECONDS;
  const unsigned = [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({ iss: clientId, iat, exp: iat + JWT_LIFETIME_SECONDS }),
  ].join(".");

  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

/** GitHub's words decide the error here, and go no further: nothing from a failure is kept. */
async function refusal(response: Response): Promise<TokenResult> {
  if (isRateLimited(response)) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return {
      ok: false,
      error: "rate_limited",
      resetAt: reset ? new Date(reset * 1000).toISOString() : null,
    };
  }

  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message : "";

  if (response.status === 401) return { ok: false, error: "not_configured" };
  if (response.status === 404) {
    // Revoked is permanent, so a wrong App id, which is also a 404, mustn't end up there.
    if (/integration/i.test(message)) return { ok: false, error: "not_configured" };
    return { ok: false, error: /^not found$/i.test(message) ? "revoked" : "upstream" };
  }
  if (response.status === 403 && /suspended/i.test(message)) return { ok: false, error: "suspended" };
  if (response.status === 422) {
    const unreachable = /repositor/i.test(message);
    return { ok: false, error: unreachable ? "no_access" : "under_permissioned" };
  }
  return { ok: false, error: "upstream" };
}

export async function requestInstallationToken(
  credentials: AppCredentials,
  githubInstallationId: number,
  {
    repositoryIds,
    fetchImpl = fetch,
  }: { repositoryIds?: number[]; fetchImpl?: typeof fetch } = {},
): Promise<TokenResult> {
  let jwt: string;
  try {
    jwt = createAppJwt(credentials);
  } catch {
    return { ok: false, error: "not_configured" };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/app/installations/${githubInstallationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "user-agent": "RepoScope",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({
          permissions: PERMISSIONS,
          ...(repositoryIds ? { repository_ids: repositoryIds } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, error: "upstream" };
  }

  if (!response.ok) return refusal(response);

  const parsed = tokenResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: "upstream" };

  const { token, expires_at, permissions } = parsed.data;
  const expiresAt = Date.parse(expires_at);
  if (Number.isNaN(expiresAt)) return { ok: false, error: "upstream" };

  const exact = Object.entries(PERMISSIONS).every(([name, level]) => permissions[name] === level);
  if (!exact) return { ok: false, error: "under_permissioned" };

  return { ok: true, token: new InstallationToken(token, expiresAt) };
}

/** Keeps one token for one job, in memory, and replaces it before it can expire mid-way. */
export function tokenSource(fresh: () => Promise<TokenResult>, now: () => number = Date.now) {
  let current: InstallationToken | null = null;

  return async (): Promise<TokenResult> => {
    if (current && current.expiresAt - now() > EXPIRY_MARGIN_MS) return { ok: true, token: current };

    const result = await fresh();
    current = result.ok ? result.token : null;
    return result;
  };
}

/** What a token request taught us about the installation, for the connection screen. */
export function statusChange(
  installation: InstallationStatus,
  result: TokenResult,
  now = Date.now(),
): Partial<InstallationStatus> | null {
  const stamp = new Date(now).toISOString();

  if (result.ok) return installation.suspended_at ? { suspended_at: null } : null;
  if (result.error === "revoked") return { revoked_at: stamp };
  if (result.error === "suspended" && !installation.suspended_at) return { suspended_at: stamp };
  return null;
}
