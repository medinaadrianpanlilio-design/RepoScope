import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { installUrl, newState, oauthCredentials } from "@/lib/github/connect";
import { saveState } from "@/lib/github/state-cookie";
import { allowRequest } from "@/lib/rate-limit";

/** Sends a signed-in user to install the App, carrying a state only this browser knows. */
export async function GET(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const dashboard = (code: string) => NextResponse.redirect(new URL(`/dashboard?github=${code}`, request.url));
  const oauth = oauthCredentials(process.env);
  if (!oauth) return dashboard("not_configured");
  if (!(await allowRequest("github", request.headers))) return dashboard("rate_limited");

  const state = newState();
  const response = NextResponse.redirect(installUrl(oauth.slug, state));
  saveState(request, response, state);
  return response;
}
