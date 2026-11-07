import { connection } from "next/server";
import { apiData, apiError } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/maintenance/plan";
import { runDailyMaintenance } from "@/lib/maintenance/run";

export const maxDuration = 300;

/** Called once a day by Vercel Cron, which sends CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  await connection();

  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return apiError("unauthorized", "Not allowed.", 401);
  }

  try {
    return apiData(await runDailyMaintenance());
  } catch (error) {
    console.error("Maintenance failed:", error instanceof Error ? error.message : "unknown error");
    return apiError("maintenance_failed", "Maintenance failed.", 500);
  }
}
