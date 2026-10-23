// Website session for Aresium: an HttpOnly cookie holding the Empire token (see empire-auth.ts,
// which checks it). 30 days, matching the token lifetime set in PocketBase.

export const COOKIE_NAME = "aresium_session";
const SESSION_SECS = 30 * 24 * 60 * 60;

/** A Set-Cookie value that stores `token` as the session. */
export function sessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${SESSION_SECS}`,
  ].join("; ");
}

/** A Set-Cookie value that clears the session (logout). */
export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** The session token from a Cookie header, or "" if there is none. */
export function sessionToken(cookieHeader: string | undefined): string {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return "";
}
