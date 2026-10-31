import assert from "node:assert/strict";
import { test } from "node:test";

// Synthetic account/token values only; fetch is replaced in every test.
process.env.EMPIRE_ALLOWED_USERS = "test-allowed-user,test-owner-on-phone";
process.env.APP_SERVER_MODE_USERS = "test-allowed-user";
const { empireTokenAccess, empireBearerAccess, empireMode, bearerToken } = await import("./empire-auth.js");
const record = { id: "test-allowed-user", approved: true, services: ["aresium"] };
const response = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

test("missing and malformed credentials deny with 401 without contacting the Empire", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  for (const access of [await empireTokenAccess(undefined), await empireTokenAccess(""), await empireBearerAccess("Basic example")]) {
    assert.deepEqual(access, { outcome: "denied", status: 401, error: "unauthenticated" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("allowed refresh is cached and forwards the visitor IP", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    assert.ok(String(_url).endsWith("/api/collections/users/auth-refresh"));
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.headers, {
      "Content-Type": "application/json", Authorization: "test-allowed-token", "X-Forwarded-For": "192.0.2.1",
    });
    assert.ok(init?.signal instanceof AbortSignal);
    return response(200, { record });
  });
  assert.deepEqual(await empireTokenAccess("test-allowed-token", "192.0.2.1"), { outcome: "allowed" });
  assert.deepEqual(await empireBearerAccess("Bearer test-allowed-token", "192.0.2.1"), { outcome: "allowed" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("token rejection and account denial have distinct cached statuses", async (t) => {
  for (const status of [400, 401, 403]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => response(status));
    const token = `test-rejected-${status}`;
    const access = await empireTokenAccess(token);
    assert.equal(access.outcome, "denied");
    assert.ok("status" in access);
    assert.equal(access.status, status === 403 ? 403 : 401);
    assert.deepEqual(await empireTokenAccess(token), access);
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test("valid accounts without approval, service access or allowlist membership deny with 403", async (t) => {
  const records = [
    { ...record, approved: false }, { ...record, services: [] }, { ...record, id: "test-other-user" },
  ];
  for (const [i, denied] of records.entries()) {
    const fetch = t.mock.method(globalThis, "fetch", async () => response(200, { record: denied }));
    const token = `test-account-denied-${i}`;
    const access = await empireTokenAccess(token);
    assert.equal(access.outcome, "denied");
    assert.ok("status" in access);
    assert.equal(access.status, 403);
    assert.deepEqual(await empireTokenAccess(token), access);
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test("unreachable, timeout, rate-limit and server failures are 503 and never cached", async (t) => {
  const failures = [
    () => { throw new TypeError("Synthetic connection failure"); },
    () => { throw new DOMException("Synthetic timeout", "TimeoutError"); },
    ...[429, 500, 502, 503, 504, 404].map((status) => () => response(status)),
    () => response(200, {}),
    () => new Response("invalid JSON", { status: 200 }),
  ];
  for (const [i, failure] of failures.entries()) {
    let first = true;
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      if (first) { first = false; return failure(); }
      return response(200, { record });
    });
    const token = `test-unavailable-${i}`;
    const access = await empireTokenAccess(token);
    assert.equal(access.outcome, "unavailable");
    assert.ok("status" in access);
    assert.equal(access.status, 503);
    assert.deepEqual(await empireTokenAccess(token), { outcome: "allowed" });
    assert.equal(fetch.mock.callCount(), 2);
    fetch.mock.restore();
  }
});

test("the mode is server for owners in APP_SERVER_MODE_USERS and phone for any other approved account with the service", async (t) => {
  const member = { ...record, id: "test-phone-user" };
  for (const [body, expected] of [
    [{ record }, { outcome: "allowed", mode: "server" }],
    // On the owner list but not in APP_SERVER_MODE_USERS: the app keeps the data on the iPhone, as everyone's.
    [{ record: { ...record, id: "test-owner-on-phone" } }, { outcome: "allowed", mode: "phone" }],
    [{ record: member }, { outcome: "allowed", mode: "phone" }],
    [{ record: { ...member, services: ["aresium", "arestemis"] } }, { outcome: "allowed", mode: "phone" }],
  ] as const) {
    const fetch = t.mock.method(globalThis, "fetch", async () => response(200, body));
    assert.deepEqual(await empireMode("test-mode-token"), expected);
    fetch.mock.restore();
  }
});

test("the mode refuses like every route: 401 for a missing or rejected token, 403 without the service, 503 when unsure", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  for (const token of [undefined, ""]) assert.deepEqual(await empireMode(token), { outcome: "denied", status: 401, error: "unauthenticated" });
  assert.equal(fetch.mock.callCount(), 0);
  fetch.mock.restore();
  const member = { ...record, id: "test-phone-user" };
  for (const [answer, status] of [
    [() => response(200, { record: { ...member, services: ["arestemis"] } }), 403],
    [() => response(200, { record: { ...member, approved: false } }), 403],
    [() => response(200, { record: { ...record, services: [] } }), 403], // on the owner list but without the service
    [() => response(403), 403], [() => response(401), 401], [() => response(400), 401],
    [() => response(503), 503], [() => response(429), 503], [() => response(200, {}), 503],
    [() => { throw new TypeError("Synthetic connection failure"); }, 503],
  ] as const) {
    const fake = t.mock.method(globalThis, "fetch", async () => answer());
    const mode = await empireMode("test-mode-refused");
    assert.equal(mode.outcome === "allowed" ? 200 : mode.status, status);
    fake.mock.restore();
  }
});

test("the mode asks the Empire every time, keeps no cache entry and logs nothing", async (t) => {
  const member = { ...record, id: "test-phone-user" };
  const fetch = t.mock.method(globalThis, "fetch", async () => response(200, { record: member }));
  const logged = ["log", "info", "warn", "error", "debug"].map((name) => t.mock.method(console, name as "log", () => {}));
  // The access cache says "no access" for this token (not on the owner list); the mode is not misled by it.
  assert.equal((await empireTokenAccess("test-mode-cached")).outcome, "denied");
  assert.deepEqual(await empireMode("test-mode-cached"), { outcome: "allowed", mode: "phone" });
  assert.deepEqual(await empireMode("test-mode-cached"), { outcome: "allowed", mode: "phone" });
  assert.equal(fetch.mock.callCount(), 3);
  // Nor does a mode answer fill the access cache for the next request.
  fetch.mock.mockImplementation(async () => response(200, { record }));
  assert.deepEqual(await empireMode("test-mode-owner"), { outcome: "allowed", mode: "server" });
  assert.deepEqual(await empireTokenAccess("test-mode-owner"), { outcome: "allowed" });
  assert.equal(fetch.mock.callCount(), 5);
  for (const method of logged) assert.equal(method.mock.callCount(), 0);
});

test("bearer tokens are read from the Authorization header only in the Bearer form", () => {
  assert.equal(bearerToken("Bearer test-token"), "test-token");
  assert.equal(bearerToken("bearer  test-token"), "test-token");
  for (const header of [undefined, "", "Basic test-token", "Bearer", "Bearer two words"]) assert.equal(bearerToken(header), undefined, header);
});
