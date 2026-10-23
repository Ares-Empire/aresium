import assert from "node:assert/strict";
import { test } from "node:test";

// Synthetic account/token values only; fetch is replaced in every test.
process.env.EMPIRE_ALLOWED_USERS = "test-allowed-user";
const { empireTokenAccess, empireBearerAccess } = await import("./empire-auth.js");
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
