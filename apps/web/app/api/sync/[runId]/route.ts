import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { bearerToken } from "@/lib/keys/keys";
import { verifyKey } from "@/lib/keys/store";
import { chunkSchema } from "@/lib/sync/schema";
import { ownsOpenRun, saveChunk } from "@/lib/sync/store";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/sync/[runId]">) {
  try {
    const userId = await verifyKey(bearerToken(request.headers.get("authorization")), "sync");
    if (!userId) return apiError("unauthorized", "That sync key isn't valid.", 401);

    const { runId } = await ctx.params;
    if (!z.uuid().safeParse(runId).success || !(await ownsOpenRun(userId, runId))) {
      return apiError("not_found", "That sync isn't open.", 404);
    }

    const parsed = chunkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("invalid_request", "That upload isn't valid.", 400);

    const result = await saveChunk(runId, parsed.data);
    return result.ok ? apiData(result) : apiError("incomplete", result.message, 409);
  } catch (error) {
    console.error("Sync failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("sync_failed", "That upload couldn't be saved.", 500);
  }
}
