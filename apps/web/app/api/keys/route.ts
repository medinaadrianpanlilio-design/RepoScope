import { z } from "zod";
import { apiData, apiError } from "@/lib/api";
import { getOptionalUser } from "@/lib/auth";
import { createKey, listKeys } from "@/lib/keys/store";

const body = z.object({
  kind: z.enum(["mcp", "sync"]),
  name: z.string().trim().min(1).max(60),
});

export async function GET() {
  const user = await getOptionalUser();
  if (!user) return apiError("unauthorized", "Sign in to manage keys.", 401);

  return apiData(await listKeys());
}

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user) return apiError("unauthorized", "Sign in to manage keys.", 401);

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_request", "Give the key a name.", 400);

  const created = await createKey(user.id, parsed.data.kind, parsed.data.name);
  if (!created) return apiError("too_many_keys", "Revoke a key before creating another.", 409);

  return apiData(created, 201);
}
