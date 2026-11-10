import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { disconnectInstallation } from "@/lib/github/connections";

/** Disconnect: RepoScope forgets the Installation and everything read through it. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/github/installations/[id]">) {
  const user = await getOptionalUser();
  if (!user) return apiError("unauthorized", "Sign in to manage GitHub.", 401);

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  try {
    return (await disconnectInstallation(user.id, id))
      ? apiData({ disconnected: true })
      : notFound();
  } catch (error) {
    console.error("Disconnect failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("disconnect_failed", "We couldn't disconnect that account. Try again.", 500);
  }
}

function notFound() {
  return apiError("not_found", "GitHub account not found.", 404);
}
