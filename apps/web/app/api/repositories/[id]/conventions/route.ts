import { checkImportRules } from "@reposcope/engine";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getLatestCompletedRun } from "@/lib/analysis/store";
import { getOptionalUser } from "@/lib/auth";
import { conventionSchema, rulesIn } from "@/lib/conventions/schema";
import { createConvention, listConventions } from "@/lib/conventions/store";
import { loadGraph } from "@/lib/graph/load";
import { getRepository } from "@/lib/repositories/queries";

type Context = RouteContext<"/api/repositories/[id]/conventions">;

const MAX_VIOLATIONS_PER_RULE = 25;

async function visibleRepository(ctx: Context) {
  const { id } = await ctx.params;
  return z.uuid().safeParse(id).success ? getRepository(id) : null;
}

export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const user = await getOptionalUser();
    if (!user) return apiError("unauthorized", "Sign in to keep Conventions.", 401);

    const repository = await visibleRepository(ctx);
    if (!repository) return notFound();

    const [conventions, run] = await Promise.all([
      listConventions(repository.id),
      getLatestCompletedRun(repository.id),
    ]);

    const rules = rulesIn(conventions);
    const graph = run && rules.length > 0 ? await loadGraph(run.id) : null;
    const paths = new Map(graph?.files.map((file) => [file.id, file.path]));
    const edges = (graph?.edges ?? []).flatMap(({ source, target, type }) => {
      const from = paths.get(source);
      const to = paths.get(target);
      return from && to ? [{ source: from, target: to, type }] : [];
    });
    const violations = checkImportRules(edges, rules);

    return apiData({
      analyzed: run !== null,
      conventions: conventions.map((item) => {
        if (item.kind !== "import_rule") return item;
        const broken = violations.filter((v) => v.ruleId === item.id);
        return {
          ...item,
          violationCount: broken.length,
          violations: broken
            .slice(0, MAX_VIOLATIONS_PER_RULE)
            .map(({ source, target, type }) => ({ source, target, type })),
        };
      }),
    });
  } catch (error) {
    console.error("Conventions failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("conventions_failed", "We couldn't load your Conventions.", 500);
  }
}

export async function POST(request: NextRequest, ctx: Context) {
  const parsed = conventionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("invalid_request", parsed.error.issues[0]?.message ?? "That isn't valid.", 400);
  }

  try {
    const user = await getOptionalUser();
    if (!user) return apiError("unauthorized", "Sign in to keep Conventions.", 401);

    const repository = await visibleRepository(ctx);
    if (!repository) return notFound();

    const created = await createConvention(user.id, repository.id, parsed.data);
    if (!created) return apiError("too_many", "Delete a Convention before adding another.", 409);

    return apiData(created, 201);
  } catch (error) {
    console.error("Conventions failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("conventions_failed", "We couldn't save that.", 500);
  }
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
