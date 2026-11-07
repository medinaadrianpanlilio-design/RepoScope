import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { conventionSchema } from "@/lib/conventions/schema";
import { deleteConvention, updateConvention } from "@/lib/conventions/store";

type Context = RouteContext<"/api/repositories/[id]/conventions/[conventionId]">;

async function target(ctx: Context) {
  const { id, conventionId } = await ctx.params;
  const valid = z.uuid().safeParse(id).success && z.uuid().safeParse(conventionId).success;
  return valid ? { id, conventionId } : null;
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const parsed = conventionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("invalid_request", parsed.error.issues[0]?.message ?? "That isn't valid.", 400);
  }

  try {
    if (!(await getOptionalUser())) return unauthorized();

    const found = await target(ctx);
    const updated = found && (await updateConvention(found.id, found.conventionId, parsed.data));
    return updated ? apiData(updated) : notFound();
  } catch (error) {
    console.error("Conventions failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("conventions_failed", "We couldn't save that.", 500);
  }
}

export async function DELETE(_request: NextRequest, ctx: Context) {
  try {
    if (!(await getOptionalUser())) return unauthorized();

    const found = await target(ctx);
    const removed = found && (await deleteConvention(found.id, found.conventionId));
    return removed ? apiData({ removed: true }) : notFound();
  } catch (error) {
    console.error("Conventions failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("conventions_failed", "We couldn't delete that.", 500);
  }
}

function unauthorized() {
  return apiError("unauthorized", "Sign in to keep Conventions.", 401);
}

function notFound() {
  return apiError("not_found", "Convention not found.", 404);
}
