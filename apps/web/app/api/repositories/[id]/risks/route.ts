import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { rulesIn } from "@/lib/conventions/schema";
import { listConventions } from "@/lib/conventions/store";
import { riskReport } from "@/lib/graph/risk-input";
import { getRepository } from "@/lib/repositories/queries";

/** Everyone sees what the analysis shows. Warnings from rules are only for the rules' owner. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/repositories/[id]/risks">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  try {
    const repository = await getRepository(id);
    if (!repository) return notFound();

    const user = await getOptionalUser();
    const rules = user ? rulesIn(await listConventions(id)) : [];
    const report = await riskReport(id, rules);

    return apiData(report ?? { compared: false, warnings: [] });
  } catch (error) {
    console.error("Risks failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("risks_failed", "We couldn't work out the warnings.", 500);
  }
}

function notFound() {
  return apiError("not_found", "Repository not found.", 404);
}
