import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { revokeKey } from "@/lib/keys/store";

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/keys/[id]">) {
  const user = await getOptionalUser();
  if (!user) return apiError("unauthorized", "Sign in to manage keys.", 401);

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError("not_found", "Key not found.", 404);

  const revoked = await revokeKey(id);
  return revoked ? apiData({ revoked: true }) : apiError("not_found", "Key not found.", 404);
}
