import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseEnv } from "./env";

export class MissingSecretKeyError extends Error {
  constructor() {
    super("SUPABASE_SECRET_KEY is not set.");
  }
}

/**
 * Bypasses Row Level Security. Use it only for server-owned writes to shared data,
 * after the input has been validated. Never use it to read a user's private data.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new MissingSecretKeyError();

  return createClient(publicSupabaseEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
