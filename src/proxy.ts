import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_ID, sessionsEnabled } from "@/server/session";

// Private sandboxes (KINWARDEN_SESSIONS=per-visitor): the first page a visitor opens gets them a cookie
// naming their own world. Only page loads hand one out, so scripts and API calls without it share one
// world instead of creating a new one per request.
export function proxy(request: NextRequest) {
  if (!sessionsEnabled() || SESSION_ID.test(request.cookies.get(SESSION_COOKIE)?.value ?? "")) return NextResponse.next();
  const dest = request.headers.get("sec-fetch-dest");
  const isPage = dest === "document" || dest === "iframe" || (!dest && (request.headers.get("accept") ?? "").includes("text/html"));
  if (!isPage) return NextResponse.next();
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, crypto.randomUUID().replaceAll("-", ""), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

export const config = {
  // pages only: not the API, build assets, icons or files
  matcher: ["/((?!api|_next|icon|apple-icon|pwa-icon|manifest.webmanifest|robots.txt|.*\\.[a-z0-9]+$).*)"],
};
