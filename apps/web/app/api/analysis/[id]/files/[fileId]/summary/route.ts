import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getSummary, saveSummary } from "@/lib/ai/summaries";
import { getFile } from "@/lib/analysis/store";
import { getOptionalUser } from "@/lib/auth";

type Context = RouteContext<"/api/analysis/[id]/files/[fileId]/summary">;

const fileIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const body = z.object({
  summary: z.string().min(1).max(4000),
  corrected: z.string().min(1).max(4000).nullable(),
  model: z.string().min(1).max(200),
});

async function findFile(ctx: Context) {
  const { id, fileId } = await ctx.params;
  const parsed = fileIdSchema.safeParse(fileId);
  if (!z.uuid().safeParse(id).success || !parsed.success) return null;

  const file = await getFile(id, parsed.data);
  return file ? { analysisId: id, filePath: file.file_path } : null;
}

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const user = await getOptionalUser();
    if (!user) return apiData(null);

    const file = await findFile(ctx);
    if (!file) return apiError("not_found", "File not found.", 404);

    return apiData(await getSummary(file.analysisId, file.filePath));
  } catch (error) {
    console.error("Summary failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("summary_failed", "We couldn't load this summary.", 500);
  }
}

export async function PUT(request: NextRequest, ctx: Context) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_request", "That summary isn't valid.", 400);

  try {
    const user = await getOptionalUser();
    if (!user) return apiError("unauthorized", "Sign in to keep summaries.", 401);

    const file = await findFile(ctx);
    if (!file) return apiError("not_found", "File not found.", 404);

    await saveSummary({ ...file, userId: user.id, ...parsed.data });
    return apiData({ saved: true });
  } catch (error) {
    console.error("Summary failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("summary_failed", "We couldn't save this summary.", 500);
  }
}
