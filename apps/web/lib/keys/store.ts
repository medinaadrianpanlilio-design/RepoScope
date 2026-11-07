import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateKey, hashKey, kindOfKey, type KeyKind } from "./keys";

const MAX_ACTIVE_KEYS = 20;
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

const LIST_COLUMNS = "id, kind, name, key_prefix, created_at, last_used_at";

/** Reads as the user, so Row Level Security limits this to their own keys. */
export async function listKeys() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select(LIST_COLUMNS)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not list keys: ${error.code}`);
  return data;
}

export async function createKey(userId: string, kind: KeyKind, name: string) {
  if ((await listKeys()).length >= MAX_ACTIVE_KEYS) return null;

  const { key, hash, prefix } = generateKey(kind);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({ user_id: userId, kind, name, key_hash: hash, key_prefix: prefix })
    .select(LIST_COLUMNS)
    .single();

  if (error) throw new Error(`Could not create key: ${error.code}`);
  return { ...data, key };
}

export async function revokeKey(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");

  if (error) throw new Error(`Could not revoke key: ${error.code}`);
  return data.length > 0;
}

/** Finds who a key belongs to. A key of the wrong kind or a revoked key finds nobody. */
export async function verifyKey(key: string | null, kind: KeyKind): Promise<string | null> {
  if (!key || kindOfKey(key) !== kind) return null;

  const db = createAdminClient();
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, last_used_at")
    .eq("key_hash", hashKey(key))
    .eq("kind", kind)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw new Error(`Could not check key: ${error.code}`);
  if (!data) return null;

  const lastUsed = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_RESOLUTION_MS) {
    await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  }
  return data.user_id;
}
