import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { GitHubToken } from "./app-auth";
import { isRateLimited } from "./client";

export const STATE_COOKIE = "rs_github_state";
export const STATE_MAX_AGE_SECONDS = 600;

const REQUEST_TIMEOUT_MS = 10_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;
const USER_TOKEN_LIFETIME_MS = 8 * 3_600_000;

export type OAuthCredentials = { clientId: string; clientSecret: string; slug: string };

export function oauthCredentials(env: Record<string, string | undefined>): OAuthCredentials | null {
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  // People often paste the App's whole public link, so keep only its name.
  const slug = env.GITHUB_APP_SLUG?.trim()
    .replace(/^.*\/apps\//, "")
    .replace(/\/+$/, "");
  return clientId && clientSecret && slug ? { clientId, clientSecret, slug } : null;
}

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function sameState(given: string | null | undefined, saved: string | null | undefined) {
  if (!given || !saved) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(saved);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function installUrl(slug: string, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

export function authorizeUrl(clientId: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export type CallbackStep =
  | { kind: "exchange"; code: string }
  | { kind: "authorize" }
  | { kind: "requested" }
  | { kind: "cancelled" }
  | { kind: "forged" };

/**
 * GitHub says an installation_id in this address can be forged, and doesn't say the install page
 * returns our state. So only a code that comes back with this browser's state is trusted. Anything
 * else starts a fresh authorization, which brings back the user's own code and nobody else's.
 */
export function callbackStep(params: URLSearchParams, savedState: string | undefined): CallbackStep {
  const code = params.get("code");
  const state = params.get("state");

  if (params.get("error")) return { kind: "cancelled" };
  if (!code && params.get("setup_action") === "request") return { kind: "requested" };
  if (state === null) return { kind: "authorize" };
  if (!sameState(state, savedState)) return { kind: "forged" };
  return code ? { kind: "exchange", code } : { kind: "cancelled" };
}

export type ExchangeResult =
  | { ok: true; token: GitHubToken }
  | { ok: false; error: "bad_code" | "not_configured" | "upstream" };

const exchangeResponse = z.union([
  z.object({ access_token: z.string().min(1), expires_in: z.number().optional() }),
  z.object({ error: z.string() }),
]);

export async function exchangeCode(
  { clientId, clientSecret }: OAuthCredentials,
  code: string,
  redirectUri: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<ExchangeResult> {
  let response: Response;
  try {
    response = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "RepoScope" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "upstream" };
  }
  if (response.status === 404) return { ok: false, error: "not_configured" }; // Unknown client id.
  if (!response.ok) return { ok: false, error: "upstream" };

  const parsed = exchangeResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: "upstream" };

  const body = parsed.data;
  if ("error" in body) {
    if (body.error === "bad_verification_code") return { ok: false, error: "bad_code" };
    if (body.error === "incorrect_client_credentials" || body.error === "redirect_uri_mismatch") {
      return { ok: false, error: "not_configured" };
    }
    return { ok: false, error: "upstream" };
  }

  const lifetime = body.expires_in ? body.expires_in * 1000 : USER_TOKEN_LIFETIME_MS;
  return { ok: true, token: new GitHubToken(body.access_token, Date.now() + lifetime) };
}

export type ListResult<T> =
  | { ok: true; items: T[]; complete: boolean }
  | { ok: false; error: "rate_limited" | "upstream" };

/** Reads up to ten pages. Past that, the list says it's incomplete rather than guessing. */
async function collect<T>(
  path: string,
  key: string,
  item: z.ZodType<T>,
  token: GitHubToken,
  fetchImpl: typeof fetch,
): Promise<ListResult<T | null>> {
  const items: (T | null)[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.github.com${path}?per_page=${PER_PAGE}&page=${page}`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token.reveal()}`,
          "user-agent": "RepoScope",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, error: "upstream" };
    }
    if (isRateLimited(response)) return { ok: false, error: "rate_limited" };
    if (!response.ok) return { ok: false, error: "upstream" };

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const list = body?.[key];
    if (!Array.isArray(list)) return { ok: false, error: "upstream" };

    // An entry of an unexpected shape is skipped, not trusted.
    items.push(...list.map((entry) => item.safeParse(entry).data ?? null));
    if (list.length < PER_PAGE) return { ok: true, items, complete: true };
  }
  return { ok: true, items, complete: false };
}

function present<T>(result: ListResult<T | null>): ListResult<T> {
  return result.ok
    ? { ...result, items: result.items.filter((item): item is T => item !== null) }
    : result;
}

export type UserInstallation = {
  githubInstallationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  suspendedAt: string | null;
};

const installationEntry = z
  .object({
    id: z.number(),
    account: z.object({ login: z.string(), type: z.enum(["User", "Organization"]) }),
    suspended_at: z.string().nullable().optional(),
  })
  .transform(
    (entry): UserInstallation => ({
      githubInstallationId: entry.id,
      accountLogin: entry.account.login,
      accountType: entry.account.type,
      suspendedAt: entry.suspended_at ?? null,
    }),
  );

type Fetching = { fetchImpl?: typeof fetch };

/** Installations of this App that the user can reach. Being listed doesn't make them theirs. */
export async function userInstallations(token: GitHubToken, { fetchImpl = fetch }: Fetching = {}) {
  return present(await collect("/user/installations", "installations", installationEntry, token, fetchImpl));
}

export type ReachableRepository = {
  githubId: number;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
};

const repositoryEntry = z
  .object({ id: z.number(), full_name: z.string(), private: z.boolean(), default_branch: z.string() })
  .transform(
    (entry): ReachableRepository => ({
      githubId: entry.id,
      fullName: entry.full_name,
      isPrivate: entry.private,
      defaultBranch: entry.default_branch,
    }),
  );

/** Everything an installation can reach, read with its own token. */
export async function installationRepositories(
  token: GitHubToken,
  { fetchImpl = fetch }: Fetching = {},
) {
  return present(await collect("/installation/repositories", "repositories", repositoryEntry, token, fetchImpl));
}

/** The part of an installation the user can see on GitHub, read with the user's token. */
export async function userRepositoryIds(
  token: GitHubToken,
  githubInstallationId: number,
  { fetchImpl = fetch }: Fetching = {},
) {
  const path = `/user/installations/${githubInstallationId}/repositories`;
  return present(await collect(path, "repositories", z.object({ id: z.number() }).transform((r) => r.id), token, fetchImpl));
}

/**
 * Linking hands the user everything the installation reaches. Being able to reach one repository
 * of an organization or a friend's account isn't enough, so every one must be visible to them.
 */
export function linkDecision(
  installationRepositoryIds: number[],
  userRepositoryIds: number[],
  complete: boolean,
): "link" | "too_broad" | "too_large" {
  if (!complete) return "too_large";
  const visible = new Set(userRepositoryIds);
  return installationRepositoryIds.every((id) => visible.has(id)) ? "link" : "too_broad";
}

/** The user's token is only needed for the checks above, so it's revoked straight after. */
export async function revokeUserToken(
  { clientId, clientSecret }: OAuthCredentials,
  token: GitHubToken,
  { fetchImpl = fetch }: Fetching = {},
): Promise<void> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
    method: "DELETE",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Basic ${basic}`,
      "content-type": "application/json",
      "user-agent": "RepoScope",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ access_token: token.reveal() }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

export const CONNECT_CODES = [
  "connected",
  "partly",
  "too_broad",
  "too_large",
  "claimed",
  "none",
  "requested",
  "cancelled",
  "forged",
  "expired",
  "rate_limited",
  "not_configured",
  "failed",
] as const;

export type ConnectCode = (typeof CONNECT_CODES)[number];

const MESSAGES: Record<ConnectCode, { tone: "good" | "info" | "problem"; text: string }> = {
  connected: { tone: "good", text: "GitHub is connected." },
  partly: {
    tone: "info",
    text: "GitHub is connected, but some installations were left out. They reach repositories you can't see, are too large to check, or belong to another RepoScope account.",
  },
  too_broad: {
    tone: "problem",
    text: "That installation reaches repositories you can't see on GitHub, so it wasn't connected. Ask an owner to limit it to repositories you have access to.",
  },
  too_large: {
    tone: "problem",
    text: "That installation reaches more than 1,000 repositories, which is too many to check. Limit it to selected repositories on GitHub.",
  },
  claimed: {
    tone: "problem",
    text: "That installation is already connected to another RepoScope account.",
  },
  none: {
    tone: "info",
    text: "GitHub didn't list any installations of RepoScope for your account. Install the App, then connect again.",
  },
  requested: {
    tone: "info",
    text: "Your request was sent. An organization owner has to approve it on GitHub before you can connect.",
  },
  cancelled: { tone: "info", text: "Connecting was cancelled. Nothing changed." },
  forged: {
    tone: "problem",
    text: "That link didn't come from this browser, so it was ignored. Start again from Connect GitHub.",
  },
  expired: { tone: "problem", text: "The GitHub sign-in expired. Connect again." },
  rate_limited: { tone: "problem", text: "GitHub is limiting requests right now. Try again in a few minutes." },
  not_configured: {
    tone: "problem",
    text: "The GitHub App isn't set up correctly on this server, so GitHub can't be connected.",
  },
  failed: { tone: "problem", text: "We couldn't reach GitHub. Try again in a minute." },
};

/** The dashboard reads the outcome from its address, so only known codes are shown. */
export function connectMessage(code: string | undefined) {
  return code && (CONNECT_CODES as readonly string[]).includes(code)
    ? MESSAGES[code as ConnectCode]
    : null;
}

export type LinkOutcome =
  | "linked"
  | "too_broad"
  | "too_large"
  | "claimed"
  | "unavailable"
  | "rate_limited"
  | "not_configured";

/** One message for the dashboard, from what happened to each installation. */
export function summarizeLinks(outcomes: LinkOutcome[]): ConnectCode {
  if (outcomes.length === 0) return "none";
  if (outcomes.includes("not_configured")) return "not_configured";

  const linked = outcomes.filter((outcome) => outcome === "linked").length;
  if (linked === outcomes.length) return "connected";
  if (linked > 0) return "partly";

  const [first] = outcomes;
  if (outcomes.every((outcome) => outcome === first)) {
    if (first === "too_broad" || first === "too_large" || first === "claimed") return first;
    if (first === "rate_limited") return "rate_limited";
  }
  return "failed";
}
