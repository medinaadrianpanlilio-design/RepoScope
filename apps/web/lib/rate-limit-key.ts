import { createHash } from "node:crypto";

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Hashes the address so raw IPs are never stored. */
export function rateLimitKey(action: string, ip: string): string {
  return `${action}:${createHash("sha256").update(ip).digest("hex")}`;
}
