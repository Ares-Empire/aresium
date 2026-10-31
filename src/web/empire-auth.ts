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
//                         Empty → nobody gets in. The one exception is GET /api/mode (empireMode):
//                         it answers every approved account with the service.
//   APP_SERVER_MODE_USERS optional, comma-separated ids from EMPIRE_ALLOWED_USERS whose iPhone app shows
//                         the server's data (GET /api/mode → "server"). Every other account, the owner's
//                         too, gets "phone": its data stays on its iPhone. Empty by default, since Patrik
//                         moved his data to the phone (2026-10-31); the website is not affected.
//   EMPIRE_AUTH_URL       optional, default http://127.0.0.1:8090 (same server, no TLS hop).
import { createHash } from "node:crypto";
import { text } from "../lib/texts.js";

const SERVICE = "aresium";
const AUTH_URL = (process.env.EMPIRE_AUTH_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
const ALLOWED = new Set(
  (process.env.EMPIRE_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
const SERVER_MODE = new Set(
  (process.env.APP_SERVER_MODE_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
const CACHE_MS = 60_000;
const CACHE_MAX = 1000;
export type EmpireAccess =
  | { outcome: "allowed" }
  | { outcome: "denied"; status: 401 | 403; error: string }
  | { outcome: "unavailable"; status: 503; error: string };

const allowed = { outcome: "allowed" } as const;
const unauthenticated = { outcome: "denied", status: 401, error: "unauthenticated" } as const;
const forbidden = { outcome: "denied", status: 403, error: text("forbidden", "en") } as const;
const unavailable = { outcome: "unavailable", status: 503, error: text("authUnavailable", "en") } as const;
const cache = new Map<string, { access: Exclude<EmpireAccess, { outcome: "unavailable" }>; until: number }>();

type EmpireRecord = { id?: unknown; approved?: unknown; services?: unknown };

// An approved account with the aresium service may use the app; only the owner list's accounts may use the server.
function hasService(record: EmpireRecord | undefined): boolean {
  return record?.approved === true && Array.isArray(record.services) && record.services.includes(SERVICE);
}
function hasAccess(record: EmpireRecord | undefined): boolean {
  return hasService(record) && typeof record?.id === "string" && ALLOWED.has(record.id);
}

const cacheKey = (token: string) => createHash("sha256").update(token).digest("base64url"); // no raw tokens kept

function remember(token: string, access: Exclude<EmpireAccess, { outcome: "unavailable" }>) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(cacheKey(token), { access, until: Date.now() + CACHE_MS });
}

async function pbPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

type TokenCheck =
  | { kind: "owner" | "member"; id: string }
  | { kind: "no-access" | "unauthenticated" | "unavailable" };

// Ask the Empire whose token this is. "member": approved with the service, not on the owner list. Caches and logs
// nothing; empireTokenAccess caches its own answer.
async function checkToken(token: string, clientIp?: string): Promise<TokenCheck> {
  try {
    const r = await pbPost("/api/collections/users/auth-refresh", {}, {
      Authorization: token, ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
    });
    if (r.ok) {
      const { record } = (await r.json()) as { record?: EmpireRecord };
      if (!record || typeof record.id !== "string") return { kind: "unavailable" };
      if (hasAccess(record)) return { kind: "owner", id: record.id };
      return hasService(record) ? { kind: "member", id: record.id } : { kind: "no-access" };
    }
    if (r.status === 400 || r.status === 401) return { kind: "unauthenticated" }; // PocketBase rejects an invalid/expired refresh token with 400
    if (r.status === 403) return { kind: "no-access" }; // PocketBase's approved/verified account rule
    return { kind: "unavailable" }; // 429, 5xx or an unexpected response: no usable check
  } catch {
    return { kind: "unavailable" }; // unreachable, timed out or an unreadable response
  }
}

/** Check the token separately from account access; an outage must never log a client out. */
export async function empireTokenAccess(token: string | undefined, clientIp?: string): Promise<EmpireAccess> {
  if (!token) return unauthenticated;
  const hit = cache.get(cacheKey(token));
  if (hit && hit.until > Date.now()) return hit.access;

  const check = await checkToken(token, clientIp);
  if (check.kind === "unavailable") return unavailable; // don't cache
  const access = check.kind === "owner" ? allowed : check.kind === "unauthenticated" ? unauthenticated : forbidden;
  remember(token, access);
  return access;
}

/** The token in an `Authorization: Bearer <token>` header, or undefined. */
export function bearerToken(authorization: string | undefined): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
}

/** Check an API client's Bearer token using the same outcomes as the website cookie. */
export async function empireBearerAccess(authorization: string | undefined, clientIp?: string): Promise<EmpireAccess> {
  const token = bearerToken(authorization);
  return token ? empireTokenAccess(token, clientIp) : unauthenticated;
}

export type EmpireMode = { outcome: "allowed"; mode: "server" | "phone" } | Exclude<EmpireAccess, { outcome: "allowed" }>;

/**
 * GET /api/mode: "server" for an owner-list account in APP_SERVER_MODE_USERS, "phone" for any other approved account
 * with the aresium service (the owner's too); 401 for a missing or rejected token, 403 without the service, 503 when the Empire cannot be asked. Asks the
 * Empire every time and keeps nothing: no cache entry, no log line.
 */
export async function empireMode(token: string | undefined, clientIp?: string): Promise<EmpireMode> {
  if (!token) return unauthenticated;
  const check = await checkToken(token, clientIp);
  switch (check.kind) {
    case "owner": return { outcome: "allowed", mode: SERVER_MODE.has(check.id) ? "server" : "phone" };
    case "member": return { outcome: "allowed", mode: "phone" };
    case "no-access": return forbidden;
    case "unauthenticated": return unauthenticated;
    case "unavailable": return unavailable;
  }
}

/** Email + password login. Returns the token, or a message for the visitor. */
export async function empireLogin(email: string, password: string, clientIp: string | undefined):
  Promise<{ token: string } | Exclude<EmpireAccess, { outcome: "allowed" }>> {
  try {
    // X-Forwarded-For: so PocketBase rate-limits per visitor, not per Aresium server
    const r = await pbPost("/api/collections/users/auth-with-password", { identity: email, password },
      clientIp ? { "X-Forwarded-For": clientIp } : {});
    if (r.ok) {
      const { token, record } = (await r.json()) as { token?: string; record?: EmpireRecord };
      if (!token || !record || typeof record.id !== "string") return unavailable;
      if (hasAccess(record)) {
        remember(token, allowed);
        return { token };
      }
      return forbidden;
    }
    if (r.status === 400) return { outcome: "denied", status: 401, error: "Wrong email or password." };
    if (r.status === 403) return { outcome: "denied", status: 403, error: "This account isn't active yet. Confirm your email, then wait for approval." };
    return unavailable;
  } catch {
    return unavailable;
  }
}
