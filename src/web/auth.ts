// In-app authentication for the dashboard — a single password + a stateless, signed
// session cookie. Replaces nginx basic-auth (which is removed from the vhost only AFTER
// this is verified). Zero dependencies: Node's crypto does scrypt (password hashing) and
// HMAC-SHA256 (cookie signing).
//
// Config (in .env, never committed):
//   AUTH_PASSWORD_HASH   scrypt hash of the password — set via `npm run set-password`
//   AUTH_SESSION_SECRET  random secret used to sign session cookies
//
// Safety: the gate is ACTIVE only when both are present. If unset, the server logs a loud
// warning and lets requests through — so deploying this code can't lock you out before you
// set a password. Order of rollout: set password → verify login works → remove nginx auth.
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "aresium_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const HASH = process.env.AUTH_PASSWORD_HASH ?? "";
const SECRET = process.env.AUTH_SESSION_SECRET ?? "";

/** Auth is enforced only when a password hash AND a signing secret are configured. */
export function authEnabled(): boolean {
  return HASH.length > 0 && SECRET.length > 0;
}

// ---- password hashing (scrypt) ----
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export function verifyPassword(password: string): boolean {
  const parts = HASH.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let dk: Buffer;
  try { dk = scryptSync(password, salt, expected.length); } catch { return false; }
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

// ---- session cookie (HMAC-signed payload) ----
const sign = (data: string) => createHmac("sha256", SECRET).update(data).digest("base64url");

/** A Set-Cookie value establishing a fresh 30-day session. */
export function sessionCookie(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  return [
    `${COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ].join("; ");
}

/** A Set-Cookie value that clears the session (logout). */
export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** True if the request carries a valid, unexpired, correctly-signed session cookie. */
export function hasValidSession(cookieHeader: string | undefined): boolean {
  if (!authEnabled() || !cookieHeader) return false;
  const entry = cookieHeader.split(/; */).find((c) => c.startsWith(COOKIE_NAME + "="));
  if (!entry) return false;
  const token = entry.slice(COOKIE_NAME.length + 1);
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}
