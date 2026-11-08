import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import {
  authorizeUrl,
  callbackStep,
  exchangeCode,
  newState,
  oauthCredentials,
  revokeUserToken,
  type ConnectCode,
} from "@/lib/github/connect";
import { connectInstallations } from "@/lib/github/connections";
import { clearState, readState, saveState } from "@/lib/github/state-cookie";
import { allowRequest } from "@/lib/rate-limit";

/**
 * Where GitHub returns after an install or an authorization. Nothing in the address is trusted:
 * installations are linked only after GitHub confirms, with the user's own token, what they can see.
 */
export async function GET(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const finish = (code: ConnectCode) => {
    const response = NextResponse.redirect(new URL(`/dashboard?github=${code}`, request.url));
    clearState(response);
    return response;
  };

  const oauth = oauthCredentials(process.env);
  if (!oauth) return finish("not_configured");

  const step = callbackStep(request.nextUrl.searchParams, readState(request));
  if (step.kind === "requested" || step.kind === "cancelled" || step.kind === "forged") {
    return finish(step.kind);
  }

  if (!(await allowRequest("github", request.headers))) return finish("rate_limited");
  const callbackUrl = `${request.nextUrl.origin}/api/github/callback`;

  if (step.kind === "authorize") {
    const state = newState();
    const response = NextResponse.redirect(authorizeUrl(oauth.clientId, state, callbackUrl));
    saveState(request, response, state);
    return response;
  }

  const exchanged = await exchangeCode(oauth, step.code, callbackUrl);
  if (!exchanged.ok) {
    return finish(exchanged.error === "bad_code" ? "expired" : exchanged.error === "upstream" ? "failed" : "not_configured");
  }

  try {
    return finish(await connectInstallations(user.id, exchanged.token));
  } finally {
    await revokeUserToken(oauth, exchanged.token);
  }
}
