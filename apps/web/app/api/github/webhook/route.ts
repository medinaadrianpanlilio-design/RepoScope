import { apiData, apiError } from "@/lib/api";
import { readWebhook, verifySignature } from "@/lib/github/webhook";
import { applyWebhook } from "@/lib/github/webhook-actions";

/** Analysis runs after the reply, so GitHub hears back well within its 10 seconds. */
export const maxDuration = 300;

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return apiError("not_configured", "Webhooks aren't set up on this server.", 503);

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return apiError("too_large", "Payload too large.", 413);

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) return apiError("too_large", "Payload too large.", 413);
  if (!verifySignature(secret, body, request.headers.get("x-hub-signature-256"))) {
    return apiError("bad_signature", "Signature doesn't match.", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return apiError("invalid_payload", "Payload isn't JSON.", 400);
  }

  try {
    const action = readWebhook(request.headers.get("x-github-event"), payload);
    return apiData(await applyWebhook(action), 202);
  } catch (error) {
    console.error("Webhook failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("webhook_failed", "Couldn't apply this delivery.", 500);
  }
}
