// Private sandboxes: with KINWARDEN_SESSIONS=per-visitor (the public deployment) every visitor gets their
// own world, keyed by a cookie that src/proxy.ts sets on the first page they open. Requests without the
// cookie (scripts, curl) share one "shared" world. Locally there is one world, as before.

export const SESSION_COOKIE = "cp_sid";
export const DEFAULT_SESSION = "default";
export const SHARED_SESSION = "shared";
export const SESSION_ID = /^[a-z0-9]{20,40}$/;

export const sessionsEnabled = () => process.env.KINWARDEN_SESSIONS === "per-visitor";

/** Which sandbox world a request belongs to. */
export function sessionId(request: Request): string {
  if (!sessionsEnabled()) return DEFAULT_SESSION;
  const m = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m && SESSION_ID.test(m[1]) ? m[1] : SHARED_SESSION;
}
