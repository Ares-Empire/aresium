import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse, type IncomingHttpHeaders } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { after, test } from "node:test";

process.env.EMPIRE_ALLOWED_USERS = "test-server-user";
process.env.APP_SERVER_MODE_USERS = "test-server-user";
const ownerDirectory = mkdtempSync(join(process.cwd(), ".test-owner-server-"));
after(() => rmSync(ownerDirectory, { recursive: true, force: true }));
process.env.ARES_OWNER_FILE = join(ownerDirectory, "owner.json");
writeFileSync(process.env.ARES_OWNER_FILE, JSON.stringify({
  name: "Example Owner", street: "Example Street 1", city: "Example City", email: "owner@example.org",
}));
const { handleRequest } = await import("./server.js");
// Requests must use the configuration loaded at startup, without reading the file again.
rmSync(process.env.ARES_OWNER_FILE);
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
    assert.deepEqual(JSON.parse(missing.body), { error: "Please log in again." });
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
    assert.deepEqual(JSON.parse(result.body), { error: "Choose a .csv or .xml file to import." });
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

const { prisma } = await import("../lib/db.js");

// Prisma's proxy methods need assignment rather than mock.method (see queries.test.ts).
function replaceQuery<T extends object, K extends keyof T>(t: import("node:test").TestContext, target: T, key: K, implementation: unknown) {
  const original = target[key];
  target[key] = implementation as T[K];
  t.after(() => { target[key] = original; });
}
const jsonBody = (value: unknown) => [Buffer.from(JSON.stringify(value))];
const languageHeaders = (language: string) => ({ authorization: "Bearer test-language-approved", "accept-language": language });
function assertError(result: Awaited<ReturnType<typeof request>>, status: number, language: string, error: string) {
  assert.equal(result.status, status);
  assert.equal(result.headers["content-language"], language);
  assert.match(result.headers["content-type"], /application\/json/);
  assert.deepEqual(JSON.parse(result.body), { error });
}

test("API auth errors follow the request language, including cached denials", async (t) => {
  for (const status of [401, 403, 503]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(status));
    for (const language of ["en", "de", "en"] as const) {
      const result = await request("/api/data", {
        authorization: `Bearer test-language-auth-${status}`, "accept-language": language,
      });
      const messages = {
        en: { 401: "Please log in again.", 403: "This account has no access to Aresium.", 503: "Login service unavailable, try again in a minute." },
        de: { 401: "Bitte melde dich erneut an.", 403: "Dieses Konto hat keinen Zugang zu Aresium.", 503: "Anmeldedienst nicht erreichbar, versuch es in einer Minute noch einmal." },
      };
      assertError(result, status, language, messages[language][status as 401 | 403 | 503]);
    }
    assert.equal(fetch.mock.callCount(), status === 503 ? 3 : 1);
    fetch.mock.restore();
  }
  assertError(await request("/api/data", { "accept-language": "de" }), 401, "de", "Bitte melde dich erneut an.");
});

test("API headers use the negotiated language and English fallback", async () => {
  for (const [header, language] of [
    [undefined, "en"], ["de", "de"], ["de-DE", "de"], ["de-DE,de;q=0.9,en;q=0.8", "de"],
    ["en", "en"], ["en-GB,de;q=0.5", "en"], ["fr", "en"], ["de;q=unreadable", "en"],
    ["en;q=0.5,de;q=0.8", "de"], ["en;q=0.8,de;q=0.8", "en"], ["de;q=0.8,en;q=0.8", "de"],
  ]) {
    assertError(await request("/api/pulse", { "accept-language": header }), 401, language!,
      language === "de" ? "Bitte melde dich erneut an." : "Please log in again.");
  }
});

test("import validation and request size errors are sentences in both languages", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  for (const language of ["en", "de"] as const) {
    for (const body of [{}, { files: [] }, { files: [{ name: "sample.txt", content: "sample" }] }]) {
      assertError(await request("/api/import", languageHeaders(language), jsonBody(body)), 400, language,
        language === "de" ? "Wähle eine .csv- oder .xml-Datei zum Importieren." : "Choose a .csv or .xml file to import.");
    }
    assertError(await request("/api/import", languageHeaders(language), [Buffer.alloc(25 * 1024 * 1024 + 1)]), 413, language,
      language === "de" ? "Der Import überschreitet die Grenze von 25 MB pro Anfrage." : "Import exceeds the 25 MB request limit.");
    assertError(await request("/api/transaction/sample/category", languageHeaders(language), [Buffer.alloc(1e6 + 1)]), 413, language,
      language === "de" ? "Diese Anfrage ist zu groß." : "This request is too large.");
  }
});

test("each file's parser and database failures are translated without exposing raw errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  t.mock.method(console, "log", () => {});
  replaceQuery(t, prisma.categoryRule, "findMany", async () => []);
  replaceQuery(t, prisma.account, "upsert", async () => { throw new Error("Synthetic internal database error"); });
  const cases = [
    ["root.xml", "<Other/>", "This file is not a CAMT bank statement.", "Diese Datei ist kein CAMT-Kontoauszug."],
    ["type.xml", "<Document><Other/></Document>", "Use a CAMT.052 or CAMT.053 bank statement.", "Verwende einen Kontoauszug im Format CAMT.052 oder CAMT.053."],
    ["paypal.csv", "Transaction ID,Name\ntest-id,Sample", "Required columns are missing from the PayPal CSV file.", "In der PayPal-CSV-Datei fehlen erforderliche Spalten."],
    ["bank.csv", "Unknown;Header\nSample;Value", "Required columns are missing from the VR Bank CSV file.", "In der VR-Bank-CSV-Datei fehlen erforderliche Spalten."],
    ["broken.csv", 'Transaction ID,Net\n"unclosed', "This file could not be read. Check the export and try again.", "Diese Datei konnte nicht gelesen werden. Prüfe den Export und versuch es noch einmal."],
    ["database.csv", "Transaction ID,Net\n", "This file could not be imported. Try again in a minute.", "Diese Datei konnte nicht importiert werden. Versuch es in einer Minute noch einmal."],
  ];
  for (const language of ["en", "de"] as const) {
    const result = await request("/api/import", languageHeaders(language), jsonBody({ files: cases.map(([name, content]) => ({ name, content })) }));
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-language"], language);
    assert.deepEqual(JSON.parse(result.body).results, cases.map(([name, _content, english, german]) => ({
      name, added: 0, total: 0, account: null, skipped: false, error: language === "de" ? german : english,
    })));
  }
});

test("a running import returns a translated 409 and releases the lock afterward", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  t.mock.method(console, "log", () => {});
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  replaceQuery(t, prisma.account, "upsert", async () => { started(); await hold; return { id: "test-account" }; });
  replaceQuery(t, prisma.transaction, "findMany", async () => []);
  replaceQuery(t, prisma.categoryRule, "findMany", async () => []);
  const first = request("/api/import", languageHeaders("de"), jsonBody({ files: [{ name: "sample.csv", content: "Transaction ID,Net\n" }] }));
  try {
    await entered;
    for (const language of ["en", "de"] as const) {
      assertError(await request("/api/import", languageHeaders(language), jsonBody({})), 409, language,
        language === "de" ? "Ein Import läuft bereits." : "An import is already running.");
    }
  } finally { release(); }
  const completed = await first;
  assert.equal(completed.status, 200);
  assert.equal(completed.headers["content-language"], "de");
  assert.deepEqual(JSON.parse(completed.body), { results: [{ name: "sample.csv", added: 0, total: 0, account: "PayPal", skipped: false }] });
  assert.equal((await request("/api/import", languageHeaders("en"), jsonBody({}))).status, 400);
});

test("transaction lookup, recategorise and tag errors follow the request language", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  let found = false;
  replaceQuery(t, prisma.transaction, "findUnique", async () => found ? { id: "sample" } : null);
  replaceQuery(t, prisma.category, "findFirst", async () => null);
  for (const language of ["en", "de"] as const) {
    found = false;
    for (const [path, body] of [
      ["/api/transaction/sample", undefined],
      ["/api/transaction/sample/category", { category: "Sample category" }],
      ["/api/transaction/sample/tags", { categories: [] }],
    ] as const) {
      assertError(await request(path, languageHeaders(language), body ? jsonBody(body) : undefined), 404, language,
        language === "de" ? "Buchung nicht gefunden." : "Transaction not found.");
    }
    found = true;
    for (const [suffix, body, english, german] of [
      ["category", { category: "Missing" }, "Category not found.", "Kategorie nicht gefunden."],
      ["tags", { categories: [], dropCurrent: true }, "Choose at least one category.", "Wähle mindestens eine Kategorie."],
      ["category", {}, "Choose a transaction and a category.", "Wähle eine Buchung und eine Kategorie."],
      ["tags", {}, "Choose a transaction and its categories.", "Wähle eine Buchung und ihre Kategorien."],
    ] as const) {
      assertError(await request(`/api/transaction/sample/${suffix}`, languageHeaders(language), jsonBody(body)), 400, language,
        language === "de" ? german : english);
    }
  }
});

test("pulse follows the request language while dashboard and old stored detail stay identical", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  const now = new Date();
  const category = { name: "Sample category", color: "#123456", excludeFromTotals: false };
  const row = {
    id: "test-old-row", bookingDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 12)),
    amount: -1339.32, category, tags: [], balance: 100, description: "Old English transaction text",
    account: { name: "Sample account" }, raw: { Note: "Old English note" },
  };
  let rows = [row];
  replaceQuery(t, prisma.transaction, "findMany", async () => rows);
  replaceQuery(t, prisma.category, "findMany", async () => [category]);
  replaceQuery(t, prisma.transaction, "findUnique", async () => row);
  const englishData = await request("/api/data", languageHeaders("en"));
  const germanData = await request("/api/data", languageHeaders("de"));
  assert.equal(germanData.status, 200);
  assert.equal(germanData.body, englishData.body);
  const englishDetail = await request("/api/transaction/test-old-row", languageHeaders("en"));
  const germanDetail = await request("/api/transaction/test-old-row", languageHeaders("de"));
  assert.equal(germanDetail.status, 200);
  assert.equal(germanDetail.body, englishDetail.body);
  assert.equal(JSON.parse(germanDetail.body).description, row.description);
  assert.equal(JSON.parse(germanDetail.body).account, "Sample account");
  for (const empty of [false, true]) {
    rows = empty ? [] : [row];
    for (const language of ["en", "de"] as const) {
      const result = await request("/api/pulse", languageHeaders(language));
      assert.equal(result.status, 200);
      assert.equal(result.headers["content-language"], language);
      assert.match(JSON.parse(result.body).line, empty
        ? (language === "de" ? /^Für .+ noch nichts importiert$/ : /^Nothing imported for .+ yet$/)
        : (language === "de" ? /^1\.339 € im .+ ausgegeben$/ : /^€1,339 spent in .+$/));
    }
  }
});

test("unexpected API failures return a translated JSON sentence", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200));
  replaceQuery(t, prisma.transaction, "findUnique", async () => { throw new Error("Synthetic database failure"); });
  for (const language of ["en", "de"] as const) {
    assertError(await request("/api/transaction/sample", languageHeaders(language)), 500, language,
      language === "de" ? "Etwas ist schiefgegangen. Versuch es in einer Minute noch einmal." : "Something went wrong. Try again in a minute.");
  }
});

test("login pages link the privacy policy and imprint on the hub", async () => {
  for (const path of ["/login", "/login/email"]) {
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.ok(result.body.includes('<a href="https://www.ares-empire.de/privacy">Privacy</a>'), path);
    assert.ok(result.body.includes('<a href="https://www.ares-empire.de/imprint">Imprint</a>'), path);
  }
});

test("German browser headers keep login pages in English", async () => {
  const result = await request("/login/email", { "accept-language": "de" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-language"], "en");
  assert.match(result.body, /<form/);
  assert.ok(result.body.includes("Log in"));
});

test("the demo and the page's files are public; the dashboard and the API stay behind the login", async (t) => {
  // No credentials, and the account server is never asked.
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("the demo must not ask the account server"); });
  const demo = await request("/demo");
  assert.equal(demo.status, 200);
  assert.match(String(demo.headers["content-type"]), /text\/html/);
  assert.match(demo.body, /app\/data\.js/);
  const slash = await request("/demo/");
  assert.equal(slash.status, 303);
  assert.equal(slash.headers.location, "/demo");
  for (const path of ["/app/data.js", "/app/dashboard.sample.json", "/fonts/fonts.css", "/brand/hermes.png"]) {
    assert.equal((await request(path)).status, 200, path);
  }
  assert.equal(fetch.mock.callCount(), 0);
  fetch.mock.restore();
  // The real dashboard and its data still need a session.
  t.mock.method(globalThis, "fetch", async () => authResponse(401));
  for (const path of ["/", "/index.html"]) {
    const page = await request(path, { cookie: "aresium_session=test-demo-none" });
    assert.equal(page.status, 303, path);
    assert.equal(page.headers.location, "/login");
  }
  assert.equal((await request("/api/data", { cookie: "aresium_session=test-demo-none" })).status, 401);
});

test("public files never reach outside web/public", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(401));
  for (const path of ["/app/../../.env", "/app/%2e%2e/%2e%2e/.env", "/brand/..%2f..%2fpackage.json", "/fonts/..%2f..%2f..%2f.env"]) {
    const result = await request(path, { cookie: "aresium_session=test-traversal" });
    assert.ok([303, 403, 404].includes(result.status), `${path} answered ${result.status}`);
    assert.doesNotMatch(result.body, /DATABASE_URL|"name": "aresium"/);
  }
});

test("the front page offers the app and the demo, not a login; the login form stays reachable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(401));
  const front = await request("/login", { cookie: "aresium_session=test-front" });
  assert.equal(front.status, 200);
  assert.match(front.body, /Get the iPhone app/);
  assert.match(front.body, /href="\/demo"/);
  assert.doesNotMatch(front.body, /href="\/login\/email"|Sign up/);
  const form = await request("/login/email", { cookie: "aresium_session=test-front" });
  assert.equal(form.status, 200);
  assert.match(form.body, /<form/);
});

test("the contact form is open to everyone, in its language, with its own policy, and never asks the account server", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("the contact page must not ask the account server"); });
  for (const [path, language, title] of [["/contact", "en", "Contact"], ["/kontakt", "de", "Kontakt"]] as const) {
    for (const headers of [{}, { cookie: "aresium_session=test-contact" }, { "accept-language": language === "en" ? "de" : "en" }]) {
      const page = await request(path, headers);
      assert.equal(page.status, 200, path);
      assert.match(String(page.headers["content-type"]), /text\/html/);
      assert.equal(page.headers["content-language"], language, path);
      assert.equal(page.headers["cache-control"], "no-cache");
      assert.match(String(page.headers["content-security-policy"]), /^default-src 'none';.*connect-src https:\/\/auth\.ares-empire\.de;/);
      assert.equal(page.headers["set-cookie"], undefined);
      assert.match(page.body, new RegExp(`<html lang="${language}" data-theme="dark">[\\s\\S]*<h1>${title}</h1>`));
      assert.equal(page.body.split('href="mailto:owner@example.org">owner@example.org</a>').length - 1, 2);
    }
  }
  for (const path of ["/forms/contact.css", "/forms/contact-form.css", "/forms/contact-form.js", "/fonts/fonts.css", "/fonts/SpaceGrotesk-Variable.ttf", "/brand/hermes.png"]) {
    assert.equal((await request(path)).status, 200, path);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("?topic=access opens the contact form on Get the app; the front page and the demo's band link there", async (t) => {
  const app = await request("/contact?topic=access");
  assert.match(app.body, /<option value="access" selected [^>]*>Get the app</);
  const german = await request("/kontakt?topic=access");
  assert.match(german.body, /<option value="access" selected [^>]*>App bekommen</);
  const other = await request("/contact?topic=%3Cscript%3E");
  assert.match(other.body, /<option value="question" selected/);
  assert.doesNotMatch(other.body, /%3Cscript|<script>/i);
  t.mock.method(globalThis, "fetch", async () => authResponse(401));
  const front = await request("/login", { cookie: "aresium_session=test-get-app" });
  assert.match(front.body, /<a class="button" href="\/contact\?topic=access">Get the iPhone app<\/a>/);
  const demo = await request("/app/data.js");
  assert.match(demo.body, /const GET_APP = "\/contact\?topic=access";/);
});

test("the contact form answers only GET and HEAD; anything else stays behind the login", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(401));
  const posted = await request("/contact", { cookie: "aresium_session=test-contact-post" }, [Buffer.from("message=x")]);
  assert.equal(posted.status, 303);
  assert.equal(posted.headers.location, "/login");
  assert.equal((await request("/contact/", { cookie: "aresium_session=test-contact-slash" })).status, 303);
});

const phoneUser = { id: "test-phone-user", approved: true, services: ["aresium"] };

test("GET /api/mode answers server for APP_SERVER_MODE_USERS and phone for other accounts with the service", async (t) => {
  const logged = ["log", "info", "warn", "error"].map((name) => t.mock.method(console, name as "log", () => {}));
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const token = (init?.headers as Record<string, string>).Authorization;
    return authResponse(200, token.includes("phone") ? phoneUser : approved);
  });
  for (const [credential, mode] of [
    [{ authorization: "Bearer test-mode-owner" }, "server"],
    [{ authorization: "Bearer test-mode-phone" }, "phone"],
    [{ cookie: "aresium_session=test-mode-owner-cookie" }, "server"],
    // The app's Bearer token is the one that counts when both are sent.
    [{ cookie: "aresium_session=test-mode-owner-cookie", authorization: "Bearer test-mode-phone" }, "phone"],
  ] as const) {
    const result = await request("/api/mode", credential);
    assert.equal(result.status, 200);
    assert.match(String(result.headers["content-type"]), /application\/json/);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers["set-cookie"], undefined);
    assert.deepEqual(JSON.parse(result.body), { mode });
  }
  for (const method of logged) assert.equal(method.mock.callCount(), 0);
});

test("/api/mode is the only route open beyond the owner list: every other route still refuses a phone account", async (t) => {
  t.mock.method(globalThis, "fetch", async () => authResponse(200, phoneUser));
  for (const path of ["/api/data", "/api/pulse", "/api/import", "/api/transaction/test", "/api/transaction/test/category", "/api/transaction/test/tags", "/api/unknown"]) {
    const result = await request(path, { authorization: "Bearer test-mode-phone-elsewhere" }, path === "/api/import" ? [Buffer.from("{}")] : undefined);
    assert.equal(result.status, 403, path);
  }
  const page = await request("/", { cookie: "aresium_session=test-mode-phone-page" });
  assert.equal(page.status, 303);
  assert.equal(page.headers.location, "/login");
  assert.deepEqual(JSON.parse((await request("/api/mode", { authorization: "Bearer test-mode-phone-elsewhere" })).body), { mode: "phone" });
});

test("/api/mode refusals carry the Empire's codes and follow the request language", async (t) => {
  const missing = await request("/api/mode", { "accept-language": "de" });
  assert.equal(missing.status, 401);
  assert.equal(missing.headers["content-language"], "de");
  assert.deepEqual(JSON.parse(missing.body), { error: "Bitte melde dich erneut an.", code: "unauthorized" });
  for (const [answer, status, code, english] of [
    [() => authResponse(401), 401, "unauthorized", "Please log in again."],
    [() => authResponse(200, { ...phoneUser, services: ["arestemis"] }), 403, "no_access", "This account has no access to Aresium."],
    [() => authResponse(200, { ...phoneUser, approved: false }), 403, "no_access", "This account has no access to Aresium."],
    [() => authResponse(403), 403, "no_access", "This account has no access to Aresium."],
    [() => authResponse(503), 503, "unavailable", "Login service unavailable, try again in a minute."],
  ] as const) {
    const fetch = t.mock.method(globalThis, "fetch", async () => answer());
    const result = await request("/api/mode", { authorization: "Bearer test-mode-refused", "accept-language": "en" });
    assert.equal(result.status, status);
    assert.equal(result.headers["content-language"], "en");
    assert.deepEqual(JSON.parse(result.body), { error: english, code });
    fetch.mock.restore();
  }
  const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(200));
  assert.deepEqual(JSON.parse((await request("/api/mode", { authorization: "Basic test-mode-basic" })).body),
    { error: "Please log in again.", code: "unauthorized" });
  assert.equal(fetch.mock.callCount(), 0);
});
