import { z } from "zod";
import type { NextRequest } from "next/server";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { getRepository, removeSavedRepository } from "@/lib/repositories/queries";

const uuid = z.uuid();

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/repositories/[id]">) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return notFound();

  const repository = await getRepository(id);
  return repository ? apiData(repository) : notFound();
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/repositories/[id]">) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return notFound();

  const user = await getOptionalUser();
  if (!user) return apiError("unauthorized", "Sign in to manage your repositories.", 401);

  const removed = await removeSavedRepository(user.id, id);
  return removed ? apiData({ removed: true }) : notFound();
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
