import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getFile, getRun } from "@/lib/analysis/store";
import { fetchSourceFile } from "@/lib/github/raw";
import { allowRequest } from "@/lib/rate-limit";
import { getRepository } from "@/lib/repositories/queries";
import { highlightSource } from "@/lib/source/highlight";

const fileIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/analysis/[id]/files/[fileId]">,
) {
  const { id, fileId } = await ctx.params;
  const parsedFileId = fileIdSchema.safeParse(fileId);
  if (!z.uuid().safeParse(id).success || !parsedFileId.success) return notFound();

  try {
    // Only a file recorded in this analysis can be requested, so no path comes from the URL.
    const [run, file] = await Promise.all([getRun(id), getFile(id, parsedFileId.data)]);
    if (!run || !file) return notFound();

    const repository = await getRepository(run.repository_id);
    if (!repository) return notFound();

    if (!(await allowRequest("source", request.headers))) {
      return apiError("too_many_requests", "Too many files opened. Try again soon.", 429);
    }

    const source = await fetchSourceFile(
      repository.owner,
      repository.name,
      run.commit_sha,
      file.file_path,
    );

    if (!source.ok) {
      return source.error === "too_large"
        ? apiError("too_large", "This file is too large to preview.", 413)
        : source.error === "not_found"
          ? apiError("source_missing", "GitHub no longer has this file at this commit.", 404)
          : apiError("github_unavailable", "We couldn't read this file from GitHub.", 502);
    }

    return apiData({
      path: file.file_path,
      language: file.language,
      lines: file.line_count,
      exports: file.exported_names,
      html: await highlightSource(source.content, file.language),
    });
  } catch (error) {
    console.error("Source failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("source_failed", "We couldn't load this file.", 500);
  }
}

function notFound() {
  return apiError("not_found", "File not found.", 404);
}
