import assert from "node:assert/strict";
import { once } from "node:events";
import { IncomingMessage, ServerResponse, type IncomingHttpHeaders } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";

process.env.EMPIRE_ALLOWED_USERS = "test-server-user";
const { handleRequest } = await import("./server.js");
const approved = { id: "test-server-user", approved: true, services: ["aresium"] };
const authResponse = (status: number, record: unknown = approved) => new Response(JSON.stringify({ record }), { status });

// Exercise Node's real HTTP request/response streams and serialization entirely in memory.
// No listening sockets, external requests, imports or database access.
async function request(path: string, headers: IncomingHttpHeaders = {}, body?: Buffer[]) {
  const output: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback(); },
  });
  const req = new IncomingMessage(socket as Socket);
  req.url = path;
  req.method = body ? "POST" : "GET";
  req.headers = { host: "test.invalid", ...headers };
  req.complete = true;
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 0;
  const res = new ServerResponse(req);
  res.assignSocket(socket as Socket);
  const finished = once(res, "finish");
  const handled = handleRequest(req, res);
  for (const chunk of body ?? []) req.push(chunk);
  req.push(null);
  await handled;
  await finished;
  assert.equal(socket.destroyed, false, "the request must not destroy the connection");
  const raw = Buffer.concat(output).toString("utf8");
  const boundary = raw.indexOf("\r\n\r\n");
  assert.ok(boundary !== -1, "a complete HTTP response must reach the client");
  const responseHeaders: Record<string, string> = {};
  for (const line of raw.slice(0, boundary).split("\r\n").slice(1)) {
    const colon = line.indexOf(":");
    responseHeaders[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: res.statusCode, headers: responseHeaders, body: raw.slice(boundary + 4) };
}

test("every API route shares the 401/403/503 JSON auth gate", async (t) => {
  const paths = ["/api/data", "/api/import", "/api/transaction/test", "/api/transaction/test/category", "/api/transaction/test/tags", "/api/unknown"];
  for (const [i, path] of paths.entries()) {
    for (const status of [401, 403, 503]) {
      const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(status));
      const result = await request(path, { authorization: `Bearer test-route-${i}-${status}` });
      assert.equal(result.status, status, path);
      assert.match(String(result.headers["content-type"]), /application\/json/);
      assert.equal(result.headers["cache-control"], "no-store");
      assert.equal(typeof JSON.parse(result.body).error, "string");
      assert.equal(result.headers["set-cookie"], undefined);
      fetch.mock.restore();
    }
    const missing = await request(path);
    assert.equal(missing.status, 401);
    assert.deepEqual(JSON.parse(missing.body), { error: "unauthenticated" });
  }
});

test("allowed bearer and session credentials pass the gate and refresh forwards Caddy's visitor IP", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)["X-Forwarded-For"], "192.0.2.2");
    return authResponse(200);
  });
  for (const credential of [{ authorization: "Bearer test-server-bearer" }, { cookie: "aresium_session=test-server-cookie" }]) {
    const result = await request("/api/import", { ...credential, "x-forwarded-for": "192.0.2.1, 192.0.2.2" }, [Buffer.from("{}")]);
    assert.equal(result.status, 400); // passed auth; empty import rejected before any DB work
    assert.deepEqual(JSON.parse(result.body), { error: "no .csv/.xml files in request" });
    assert.equal(result.headers["set-cookie"], undefined);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("unavailable sessions show a 503 page and recover on the next request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(503));
  for (const [i, path] of ["/", "/login", "/login/email", "/sso"].entries()) {
    const token = `test-page-unavailable-${i}`;
    const result = await request(path, { cookie: `aresium_session=${token}` }, path === "/sso" ? [Buffer.from(`token=${token}`)] : undefined);
    assert.equal(result.status, 503);
    assert.match(result.body, /Login service unavailable, try again in a minute/);
    assert.doesNotMatch(result.body, /<form/);
    assert.equal(result.headers["set-cookie"], undefined);
  }
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  const recovered = await request("/login", { cookie: "aresium_session=test-page-unavailable-0" });
  assert.equal(recovered.status, 303);
  assert.equal(recovered.headers.location, "/");
});

test("denied website sessions still redirect to login and login forms stay reachable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(403));
  const denied = await request("/", { cookie: "aresium_session=test-page-denied" });
  assert.equal(denied.status, 303);
  assert.equal(denied.headers.location, "/login");
  const login = await request("/login/email", { cookie: "aresium_session=test-page-denied" });
  assert.equal(login.status, 200);
  assert.match(login.body, /<form/);
});

test("login POST also returns the 503 page during an outage or rate limit", async (t) => {
  for (const failure of [
    () => authResponse(429), () => authResponse(503),
    () => { throw new TypeError("Synthetic login connection failure"); },
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => failure());
    const result = await request("/login", {}, [Buffer.from("email=sample%40example.invalid&password=test-password")]);
    assert.equal(result.status, 503);
    assert.match(result.body, /Login service unavailable, try again in a minute/);
    assert.doesNotMatch(result.body, /<form/);
    assert.equal(result.headers["set-cookie"], undefined);
    fetch.mock.restore();
  }
});

test("successful login and SSO keep session cookie attributes and logout still clears it", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: unknown) => String(url).endsWith("auth-with-password")
    ? new Response(JSON.stringify({ token: "test-login-cookie-token", record: approved }))
    : authResponse(200));
  for (const [path, form, token] of [
    ["/login", "email=sample%40example.invalid&password=test-password", "test-login-cookie-token"],
    ["/sso", "token=test-sso-cookie-token", "test-sso-cookie-token"],
  ]) {
    const result = await request(path, {}, [Buffer.from(form)]);
    assert.equal(result.status, 303);
    assert.equal(result.headers.location, "/");
    assert.equal(result.headers["set-cookie"], `aresium_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  }
  const logout = await request("/logout");
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.location, "/login");
  assert.equal(logout.headers["set-cookie"], "aresium_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
});

test("either credential can allow access; an unresolved credential preserves the session on outage", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const token = (init?.headers as Record<string, string>).Authorization;
    return authResponse(token.endsWith("allowed") ? 200 : token.endsWith("unavailable") ? 503 : 403);
  });
  for (const [cookie, bearer, status] of [
    ["denied", "allowed", 400], ["allowed", "unavailable", 400],
    ["unavailable", "denied", 503], ["denied", "unavailable", 503],
  ] as const) {
    const result = await request("/api/import", {
      cookie: `aresium_session=test-mixed-cookie-${cookie}`, authorization: `Bearer test-mixed-bearer-${bearer}`,
    }, [Buffer.from("{}")]);
    assert.equal(result.status, status);
  }
});

test("oversized import sends JSON 413 with the 25 MB limit, including multibyte bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  const limit = 25 * 1024 * 1024;
  // Valid JSON of exactly the limit passes the size check, then fails import validation.
  const exact = Buffer.from(`"${"a".repeat(limit - 2)}"`);
  const atLimit = await request("/api/import", { authorization: "Bearer test-import-limit" }, [exact]);
  assert.equal(atLimit.status, 400);
  for (const content of [Buffer.alloc(limit + 1, "a"), Buffer.from("é".repeat(limit / 2 + 1))]) {
    const result = await request("/api/import", { authorization: "Bearer test-import-limit" }, [content, Buffer.from("discard the rest")]);
    assert.equal(result.status, 413);
    assert.match(String(result.headers["content-type"]), /application\/json/);
    assert.deepEqual(JSON.parse(result.body), { error: "Import exceeds the 25 MB request limit." });
  }
});
