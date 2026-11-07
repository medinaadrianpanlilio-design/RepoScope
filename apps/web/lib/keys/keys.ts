import { createHash, randomBytes } from "node:crypto";

export type KeyKind = "mcp" | "sync";

const PREFIX_LENGTH = 12;

/** The key is random and long, so a plain hash is safe. It's shown once and never stored. */
export function generateKey(kind: KeyKind) {
  const key = `rs_${kind}_${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, PREFIX_LENGTH) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function kindOfKey(key: string): KeyKind | null {
  return /^rs_(mcp|sync)_./.exec(key)?.[1] as KeyKind | undefined ?? null;
}

export function bearerToken(header: string | null): string | null {
  const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
  return token ?? null;
}
