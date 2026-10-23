// Empire accounts (PocketBase at auth.ares-empire.de) — the only way into Aresium.
// - Website: log in with email + password (or arrive from the hub, which hands over the token);
//   the session cookie holds the Empire token.
// - iPhone app: logs in at the Empire and sends `Authorization: Bearer <token>` to /api/*.
//
// A token stays valid until it expires even if the account is un-approved meanwhile, so we don't
// trust it alone: PocketBase's auth-refresh re-checks "verified && approved" and returns the
// account, whose `services` must contain "aresium". Answers are cached briefly per token.
//
// Config (.env, never committed):
//   EMPIRE_ALLOWED_USERS  comma-separated PocketBase user ids. Aresium holds one person's data
//                         until it becomes multi-user, so only these accounts get in.
//                         Empty → nobody gets in.
//   EMPIRE_AUTH_URL       optional, default http://127.0.0.1:8090 (same server, no TLS hop).
import { createHash } from "node:crypto";

const SERVICE = "aresium";
const AUTH_URL = (process.env.EMPIRE_AUTH_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
const ALLOWED = new Set(
  (process.env.EMPIRE_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
const CACHE_MS = 60_000;
const CACHE_MAX = 1000;
const cache = new Map<string, { ok: boolean; until: number }>();

type EmpireRecord = { id?: unknown; approved?: unknown; services?: unknown };

function hasAccess(record: EmpireRecord | undefined): boolean {
  return record?.approved === true
    && Array.isArray(record.services) && record.services.includes(SERVICE)
    && typeof record.id === "string" && ALLOWED.has(record.id);
}

const cacheKey = (token: string) => createHash("sha256").update(token).digest("base64url"); // no raw tokens kept

function remember(token: string, ok: boolean) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(cacheKey(token), { ok, until: Date.now() + CACHE_MS });
}

async function pbPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

/** True if `token` belongs to an approved Empire account allowed into Aresium. */
export async function empireTokenOk(token: string | undefined): Promise<boolean> {
  if (!token || ALLOWED.size === 0) return false;
  const hit = cache.get(cacheKey(token));
  if (hit && hit.until > Date.now()) return hit.ok;

  let ok = false;
  try {
    const r = await pbPost("/api/collections/users/auth-refresh", {}, { Authorization: token });
    if (r.ok) {
      const { record } = (await r.json()) as { record?: EmpireRecord };
      ok = hasAccess(record);
    } else if (r.status >= 500 || r.status === 429) {
      return false; // auth server trouble: deny now, but don't cache it
    }
  } catch {
    return false; // auth server unreachable: deny, don't cache
  }
  remember(token, ok);
  return ok;
}

/** True if `authorization` is "Bearer <token>" for an account allowed into Aresium. */
export async function empireBearerOk(authorization: string | undefined): Promise<boolean> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  return m ? empireTokenOk(m[1]) : false;
}

/** Email + password login. Returns the token, or a message for the visitor. */
export async function empireLogin(email: string, password: string, clientIp: string | undefined):
  Promise<{ token: string } | { error: string }> {
  let r: Response;
  try {
    // X-Forwarded-For: so PocketBase rate-limits per visitor, not per Aresium server
    r = await pbPost("/api/collections/users/auth-with-password", { identity: email, password },
      clientIp ? { "X-Forwarded-For": clientIp } : {});
  } catch {
    return { error: "Login is unavailable right now. Try again in a minute." };
  }
  if (r.ok) {
    const { token, record } = (await r.json()) as { token?: string; record?: EmpireRecord };
    if (token && hasAccess(record)) {
      remember(token, true);
      return { token };
    }
    return { error: "This account has no access to Aresium." };
  }
  if (r.status === 400) return { error: "Wrong email or password." };
  if (r.status === 403) return { error: "This account isn't active yet. Confirm your email, then wait for approval." };
  if (r.status === 429) return { error: "Too many attempts. Wait a minute and try again." };
  return { error: "Login is unavailable right now. Try again in a minute." };
}
