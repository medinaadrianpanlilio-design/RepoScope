import { apiData, apiError } from "@/lib/api";
import { bearerToken } from "@/lib/keys/keys";
import { verifyKey } from "@/lib/keys/store";
import { startSchema } from "@/lib/sync/schema";
import { startSync } from "@/lib/sync/store";

export async function POST(request: Request) {
  try {
    const userId = await verifyKey(bearerToken(request.headers.get("authorization")), "sync");
    if (!userId) return apiError("unauthorized", "That sync key isn't valid.", 401);

    const parsed = startSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("invalid_request", "That sync request isn't valid.", 400);

    return apiData(await startSync(userId, parsed.data));
  } catch (error) {
    console.error("Sync failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("sync_failed", "The sync couldn't start.", 500);
  }
}
