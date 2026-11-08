import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimitKey } from "./rate-limit-key";

const LIMITS = {
  import: { limit: 20, windowSeconds: 3600 },
  analyze: { limit: 10, windowSeconds: 3600 },
  source: { limit: 300, windowSeconds: 3600 },
  github: { limit: 30, windowSeconds: 3600 },
} as const;

/** Returns true when the request may go ahead. */
export async function allowRequest(action: keyof typeof LIMITS, headers: Headers) {
  const { limit, windowSeconds } = LIMITS[action];
  const { data, error } = await createAdminClient().rpc("check_rate_limit", {
    p_key: rateLimitKey(action, clientIp(headers)),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) throw new Error(`Could not check rate limit: ${error.code}`);
  return data === true;
}
