import type { NextRequest, NextResponse } from "next/server";
import { STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "./connect";

const PATH = "/api/github";

export function readState(request: NextRequest): string | undefined {
  return request.cookies.get(STATE_COOKIE)?.value;
}

/** Only this browser can read it, and only on GitHub's way back to the callback. */
export function saveState(request: NextRequest, response: NextResponse, state: string) {
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: PATH,
    maxAge: STATE_MAX_AGE_SECONDS,
  });
}

export function clearState(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", { path: PATH, maxAge: 0 });
}
