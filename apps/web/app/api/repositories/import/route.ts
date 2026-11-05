import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { fetchRepositoryMetadata } from "@/lib/github/client";
import { importRepository } from "@/lib/repositories/import";
import { saveRepository, upsertRepository } from "@/lib/repositories/queries";
import { MissingSecretKeyError } from "@/lib/supabase/admin";

const body = z.object({ url: z.string().max(2048) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("invalid_request", "Send a JSON body with a url field.", 400);
  }

  try {
    const user = await getOptionalUser();
    const result = await importRepository(
      { url: parsed.data.url, userId: user?.id ?? null },
      {
        lookup: (owner, repo) =>
          fetchRepositoryMetadata(owner, repo, { token: process.env.GITHUB_TOKEN }),
        upsert: upsertRepository,
        save: saveRepository,
      },
    );

    if (!result.ok) return apiError(result.code, result.message, result.status);
    return apiData({ repositoryId: result.repositoryId }, 201);
  } catch (error) {
    if (error instanceof MissingSecretKeyError) {
      console.error("Import failed: SUPABASE_SECRET_KEY is not configured.");
      return apiError("not_configured", "Importing isn't configured on this server yet.", 503);
    }
    console.error("Import failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("import_failed", "Something went wrong saving that repository.", 500);
  }
}
