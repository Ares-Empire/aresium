// Empire accounts (PocketBase at auth.ares-empire.de) for the API — how the iPhone app gets in.
// The app logs in at the Empire, then sends `Authorization: Bearer <token>` to /api/*.
//
// A token stays valid until it expires even if the account is un-approved meanwhile, so we don't
// trust it alone: PocketBase's auth-refresh re-checks "verified && approved" and returns the
// account, whose `services` must contain "aresium". Answers are cached briefly per token.
//
// Config (.env, never committed):
//   EMPIRE_ALLOWED_USERS  comma-separated PocketBase user ids. Aresium holds one person's data
//                         until it becomes multi-user, so only these accounts may use the API.
//                         Empty → bearer login is off.
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

/** True if `authorization` is "Bearer <token>" for an approved Empire account allowed into Aresium. */
export async function empireBearerOk(authorization: string | undefined): Promise<boolean> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m || ALLOWED.size === 0) return false;
  const token = m[1];
  const key = createHash("sha256").update(token).digest("base64url"); // don't keep raw tokens around
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.ok;

  let ok = false;
  try {
    const r = await fetch(`${AUTH_URL}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: token },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const { record } = (await r.json()) as { record?: EmpireRecord };
      ok = record?.approved === true
        && Array.isArray(record.services) && record.services.includes(SERVICE)
        && typeof record.id === "string" && ALLOWED.has(record.id);
    } else if (r.status >= 500 || r.status === 429) {
      return false; // auth server trouble: deny now, but don't cache it
    }
  } catch {
    return false; // auth server unreachable: deny, don't cache
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { ok, until: now + CACHE_MS });
  return ok;
}
