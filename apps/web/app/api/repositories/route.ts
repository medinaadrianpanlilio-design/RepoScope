import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { listSavedRepositories } from "@/lib/repositories/queries";

export async function GET() {
  const user = await getOptionalUser();
  if (!user) return apiError("unauthorized", "Sign in to see your repositories.", 401);

  return apiData(await listSavedRepositories());
}
