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

test(
  "every API route shares the 401/403/503 JSON auth gate",
  async (t) => {
    const paths = [
      "/api/data",
      "/api/import",
      "/api/transaction/test",
      "/api/transaction/test/category",
      "/api/transaction/test/tags",
      "/api/unknown",
      "/api/fixed-costs",
      "/api/undo",
      "/api/paybacks/preview",
      "/api/paybacks",
      "/api/paybacks/link",
      "/api/names",
      "/api/names/display",
      "/api/selection",
      "/api/transactions",
      "/api/quick-sort",
      "/api/categories",
      "/api/cash"
    ];
    for (const [i, path] of paths.entries()) {
      for (const status of [401, 403, 503]) {
        const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(status));
        const result = await request(path, {
          authorization: `Bearer test-route-${i}-${status}`
        });
        assert.equal(result.status, status, path);
        assert.match(String(result.headers["content-type"]), /application\/json/);
        assert.equal(result.headers["cache-control"], "no-store");
        assert.equal(typeof JSON.parse(result.body).error, "string");
        assert.equal(result.headers["set-cookie"], undefined);
        fetch.mock.restore();
      }
      const missing = await request(path);
      assert.equal(missing.status, 401);
      assert.deepEqual(JSON.parse(missing.body), {
        error: "Please log in again."
      });
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

test(
  "unavailable sessions show a 503 page and recover on the next request",
  async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(503));
    for (const [i, path] of ["/", "/login", "/login/email", "/sso"].entries()) {
      const token = `test-page-unavailable-${i}`;
      const result = await request(
        path,
        {
          cookie: `aresium_session=${token}`
        },
        path === "/sso" ? [Buffer.from(`token=${token}`)] : undefined);
      assert.equal(result.status, 503);
      assert.match(result.body, /Login service unavailable, try again in a minute/);
      assert.doesNotMatch(result.body, /<form/);
      assert.equal(result.headers["set-cookie"], undefined);
    }
    fetch.mock.restore();
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const recovered = await request("/login", {
      cookie: "aresium_session=test-page-unavailable-0"
    });
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

test(
  "successful login and SSO keep session cookie attributes and logout still clears it",
  async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      async (url: unknown) => String(url).endsWith("auth-with-password")
        ? new Response(
          JSON.stringify({
            token: "test-login-cookie-token",
            record: approved
          }))
        : authResponse(200));
    for (const [path, form, token] of [
      ["/login", "email=sample%40example.invalid&password=test-password", "test-login-cookie-token"],
      ["/sso", "token=test-sso-cookie-token", "test-sso-cookie-token"],
    ]) {
      const result = await request(path, {}, [Buffer.from(form)]);
      assert.equal(result.status, 303);
      assert.equal(result.headers.location, "/");
      assert.equal(
        result.headers["set-cookie"],
        `aresium_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    }
    const logout = await request("/logout");
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.location, "/login");
    assert.equal(
      logout.headers["set-cookie"],
      "aresium_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

test(
  "either credential can allow access; an unresolved credential preserves the session on outage",
  async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init?: RequestInit) => {
        const token = (init?.headers as Record<string, string>).Authorization;
        return authResponse(token.endsWith("allowed") ? 200 : token.endsWith("unavailable") ? 503 : 403);
      });
    for (const [cookie, bearer, status] of [
      ["denied", "allowed", 400],
      ["allowed", "unavailable", 400],
      ["unavailable", "denied", 503],
      ["denied", "unavailable", 503],
    ] as const) {
      const result = await request(
        "/api/import",
        {
          cookie: `aresium_session=test-mixed-cookie-${cookie}`,
          authorization: `Bearer test-mixed-bearer-${bearer}`,
        },
        [Buffer.from("{}")]);
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

test(
  "API auth errors follow the request language, including cached denials",
  async (t) => {
    for (const status of [401, 403, 503]) {
      const fetch = t.mock.method(globalThis, "fetch", async () => authResponse(status));
      for (const language of ["en", "de", "en"] as const) {
        const result = await request(
          "/api/data",
          {
            authorization: `Bearer test-language-auth-${status}`,
            "accept-language": language,
          });
        const messages = {
          en: {
            401: "Please log in again.",
            403: "This account has no access to Aresium.",
            503: "Login service unavailable, try again in a minute."
          },
          de: {
            401: "Bitte melde dich erneut an.",
            403: "Dieses Konto hat keinen Zugang zu Aresium.",
            503: "Anmeldedienst nicht erreichbar, versuch es in einer Minute noch einmal."
          },
        };
        assertError(result, status, language, messages[language][status as 401 | 403 | 503]);
      }
      assert.equal(fetch.mock.callCount(), status === 503 ? 3 : 1);
      fetch.mock.restore();
    }
    assertError(
      await request("/api/data", {
        "accept-language": "de"
      }),
      401,
      "de",
      "Bitte melde dich erneut an.");
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

test(
  "each file's parser and database failures are translated without exposing raw errors",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    t.mock.method(console, "log", () => { });
    replaceQuery(t, prisma.categoryRule, "findMany", async () => []);
    replaceQuery(
      t,
      prisma.account,
      "upsert",
      async () => {
        throw new Error("Synthetic internal database error");
      });
    replaceQuery(t, prisma.transaction, "findMany", async () => []);
    const cases = [
      [
        "root.xml",
        "<Other/>",
        "This file is not a CAMT bank statement.",
        "Diese Datei ist kein CAMT-Kontoauszug."
      ],
      [
        "type.xml",
        "<Document><Other/></Document>",
        "Use a CAMT.052 or CAMT.053 bank statement.",
        "Verwende einen Kontoauszug im Format CAMT.052 oder CAMT.053."
      ],
      [
        "paypal.csv",
        "Transaction ID,Name\ntest-id,Sample",
        "Required columns are missing from the PayPal CSV file.",
        "In der PayPal-CSV-Datei fehlen erforderliche Spalten."
      ],
      [
        "bank.csv",
        "Unknown;Header\nSample;Value",
        "Required columns are missing from the VR Bank CSV file.",
        "In der VR-Bank-CSV-Datei fehlen erforderliche Spalten."
      ],
      [
        "broken.csv",
        'Transaction ID,Net\n"unclosed',
        "This file could not be read. Check the export and try again.",
        "Diese Datei konnte nicht gelesen werden. Prüfe den Export und versuch es noch einmal."
      ],
      [
        "database.csv",
        "Transaction ID,Net\n",
        "This file could not be imported. Try again in a minute.",
        "Diese Datei konnte nicht importiert werden. Versuch es in einer Minute noch einmal."
      ],
    ];
    for (const language of ["en", "de"] as const) {
      const result = await request(
        "/api/import",
        languageHeaders(language),
        jsonBody(
          {
            files: cases.map(([name, content]) => ({
              name,
              content
            }))
          }));
      assert.equal(result.status, 200);
      assert.equal(result.headers["content-language"], language);
      assert.deepEqual(
        JSON.parse(result.body).results,
        cases.map(
          ([name, _content, english, german]) => ({
            name,
            added: 0,
            total: 0,
            account: null,
            skipped: false,
            error: language === "de" ? german : english,
          })));
    }
  });

test(
  "a running import returns a translated 409 and releases the lock afterward",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    t.mock.method(console, "log", () => { });
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    replaceQuery(
      t,
      prisma.account,
      "upsert",
      async () => {
        started();
        await hold;
        return {
          id: "test-account"
        };
      });
    replaceQuery(t, prisma.transaction, "findMany", async () => []);
    replaceQuery(t, prisma.categoryRule, "findMany", async () => []);
    const first = request(
      "/api/import",
      languageHeaders("de"),
      jsonBody(
        {
          files: [{
            name: "sample.csv",
            content: "Transaction ID,Net\n"
          }]
        }));
    try {
      await entered;
      for (const language of ["en", "de"] as const) {
        assertError(
          await request("/api/import", languageHeaders(language), jsonBody({})),
          409,
          language,
          language === "de" ? "Ein Import läuft bereits." : "An import is already running.");
      }
    } finally {
      release();
    }
    const completed = await first;
    assert.equal(completed.status, 200);
    assert.equal(completed.headers["content-language"], "de");
    assert.deepEqual(
      JSON.parse(completed.body),
      {
        results: [
          {
            name: "sample.csv",
            added: 0,
            total: 0,
            account: "PayPal",
            skipped: false
          }
        ]
      });
    assert.equal((await request("/api/import", languageHeaders("en"), jsonBody({}))).status, 400);
  });

test(
  "transaction lookup, recategorise and tag errors follow the request language",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    let found = false;
    replaceQuery(t, prisma.transaction, "findUnique", async () => found ? {
      id: "sample"
    } : null);
    replaceQuery(t, prisma.category, "findFirst", async () => null);
    for (const language of ["en", "de"] as const) {
      found = false;
      for (const [path, body] of [
        ["/api/transaction/sample", undefined],
        ["/api/transaction/sample/category", {
          category: "Sample category"
        }],
        ["/api/transaction/sample/tags", {
          categories: []
        }],
      ] as const) {
        assertError(
          await request(path, languageHeaders(language), body ? jsonBody(body) : undefined),
          404,
          language,
          language === "de" ? "Buchung nicht gefunden." : "Transaction not found.");
      }
      found = true;
      for (const [suffix, body, english, german] of [
        [
          "category",
          {
            category: "Missing"
          },
          "Category not found.",
          "Kategorie nicht gefunden."
        ],
        [
          "tags",
          {
            categories: [],
            dropCurrent: true
          },
          "Choose at least one category.",
          "Wähle mindestens eine Kategorie."
        ],
        [
          "category",
          {},
          "Choose a transaction and a category.",
          "Wähle eine Buchung und eine Kategorie."
        ],
        [
          "tags",
          {},
          "Choose a transaction and its categories.",
          "Wähle eine Buchung und ihre Kategorien."
        ],
      ] as const) {
        assertError(
          await request(`/api/transaction/sample/${suffix}`, languageHeaders(language), jsonBody(body)),
          400,
          language,
          language === "de" ? german : english);
      }
    }
  });

test(
  "pulse follows the request language while dashboard and old stored detail stay identical",
  async (t) => {
    replaceQuery(
      t,
      prisma,
      "$transaction",
      async (fn: (db: typeof prisma) => Promise<unknown>) => fn(prisma));
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const now = new Date();
    const category = {
      name: "Sample category",
      color: "#123456",
      excludeFromTotals: false
    };
    const row = {
      id: "test-old-row",
      bookingDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 12)),
      amount: -1339.32,
      category,
      tags: [],
      balance: 100,
      description: "Old English transaction text",
      account: {
        name: "Sample account"
      },
      raw: {
        Note: "Old English note"
      },
    };
    let rows = [row];
    replaceQuery(t, prisma.transaction, "findMany", async () => rows);
    replaceQuery(t, prisma.category, "findMany", async () => [category]);
    replaceQuery(t, prisma.transaction, "findUnique", async () => row);
    replaceQuery(t, prisma.webSettings, "findUnique", async () => null);
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
        assert.match(
          JSON.parse(result.body).line,
          empty
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

test(
  "public files never reach outside web/public",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(401));
    for (const path of [
      "/app/../../.env",
      "/app/%2e%2e/%2e%2e/.env",
      "/brand/..%2f..%2fpackage.json",
      "/fonts/..%2f..%2f..%2f.env"
    ]) {
      const result = await request(path, {
        cookie: "aresium_session=test-traversal"
      });
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

test(
  "fixed-cost and undo routes require the same login and translate malformed requests",
  async (t) => {
    for (const path of ["/api/fixed-costs", "/api/undo"]) {
      assert.equal((await request(path, {}, jsonBody({}))).status, 401);
      const denied = t.mock.method(globalThis, "fetch", async () => authResponse(403));
      assert.equal(
        (await request(path, {
          authorization: "Bearer test-fixed-denied"
        }, jsonBody({}))).status,
        403);
      denied.mock.restore();
    }
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    for (const language of ["en", "de"]) {
      const fixed = await request("/api/fixed-costs", languageHeaders(language), jsonBody({}));
      assert.equal(fixed.status, 400);
      assert.equal(fixed.headers["content-language"], language);
      assert.equal((await request("/api/undo", languageHeaders(language), jsonBody({}))).status, 409);
    }
  });

test(
  "fixed-cost exclusion persists, Count again restores it, undo is single-use and refuses an intervening import",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const category = {
      id: "fictional-housing",
      name: "Housing",
      icon: "House",
      color: "#123456",
      excludeFromTotals: false
    };
    let rows = [7, 8, 9, 10].map(
      (month, i) => ({
        id: "fictional-rent" + i,
        bookingDate: new Date(`2026-${String(month).padStart(2, "0")}-03T12:00Z`),
        createdAt: new Date(Date.UTC(2026, 0, i + 1)),
        amount: -800,
        currency: "EUR",
        categoryId: category.id,
        category,
        tags: [],
        balance: null,
        description: "Fictional rent",
        counterparty: "Fictional Housing",
        raw: {},
      }));
    let settings: unknown = null;
    const undos = new Map<string, unknown>();
    let counter = 0;
    replaceQuery(t, prisma.transaction, "findMany", async () => rows);
    replaceQuery(t, prisma.category, "findMany", async () => [category]);
    replaceQuery(t, prisma.categoryRule, "findMany", async () => []);
    replaceQuery(
      t,
      prisma.webSettings,
      "findUnique",
      async () => settings ? {
        data: settings
      } : null);
    replaceQuery(
      t,
      prisma.webSettings,
      "upsert",
      async (args: {
        update: {
          data: unknown
        }
      }) => {
        settings = structuredClone(args.update.data);
        return {};
      });
    replaceQuery(t, prisma.webUndo, "deleteMany", async () => ({}));
    replaceQuery(
      t,
      prisma.webUndo,
      "create",
      async ({ data }: {
        data: object
      }) => {
        const id = "undo" + ++counter;
        undos.set(id, {
          id,
          ...structuredClone(data)
        });
        return {
          id
        };
      });
    replaceQuery(
      t,
      prisma.webUndo,
      "findUnique",
      async ({ where }: {
        where: {
          id: string
        }
      }) => undos.get(where.id) || null);
    replaceQuery(
      t,
      prisma.webUndo,
      "delete",
      async ({ where }: {
        where: {
          id: string
        }
      }) => {
        undos.delete(where.id);
        return {};
      });
    replaceQuery(
      t,
      prisma,
      "$transaction",
      async (fn: (db: typeof prisma) => Promise<unknown>) => fn(prisma));
    const dashboard = () => request("/api/data", languageHeaders("en")).then((r) => JSON.parse(r.body));
    const post = (path: string, body: object) => request(path, languageHeaders("en"), jsonBody(body));
    const entry = (await dashboard()).fixedCosts.expenses.running[0];
    assert.equal(entry.amount, 800);
    const change = await post("/api/fixed-costs", {
      id: entry.id,
      ids: entry.ids,
      notFixed: true
    });
    assert.equal(change.status, 200);
    assert.equal((await dashboard()).fixedCosts.expenses.monthlyTotal, 0);
    assert.equal((await dashboard()).fixedCosts.expenses.takenOut[0].id, entry.id);
    const token = JSON.parse(change.body).undo;
    assert.equal((await post("/api/undo", {
      undo: token
    })).status, 200);
    assert.equal((await dashboard()).fixedCosts.expenses.monthlyTotal, 800);
    assert.equal((await post("/api/undo", {
      undo: token
    })).status, 409);
    const stale = JSON.parse(
      (await post(
        "/api/fixed-costs",
        {
          id: entry.id,
          ids: entry.ids,
          notFixed: true
        })).body).undo;
    rows = [
      ...rows,
      {
        ...rows[0],
        id: "fictional-new",
        bookingDate: new Date("2026-11-03T12:00Z"),
        createdAt: new Date("2026-11-04T12:00Z")
      }
    ];
    assert.equal((await post("/api/undo", {
      undo: stale
    })).status, 409);
    assert.equal(
      (await post(
        "/api/fixed-costs",
        {
          id: entry.id,
          ids: entry.ids,
          notFixed: false
        })).status,
      409);
    const live = (await dashboard()).fixedCosts.expenses.takenOut[0];
    assert.equal(live.id, entry.id);
    assert.equal(live.count, 5);
    assert.equal(
      (await post(
        "/api/fixed-costs",
        {
          id: live.id,
          ids: live.ids,
          notFixed: false
        })).status,
      200);
    assert.equal((await dashboard()).fixedCosts.expenses.monthlyTotal, 800);
  });

function fakeLedger(t: import("node:test").TestContext, rows: any[], categories: any[]) {
  const state = {
    rows,
    categories,
    settings: null as any,
    corrections: [] as any[],
    undos: new Map<string, any>(),
    counter: 0
  };
  replaceQuery(
    t,
    prisma.transaction,
    "findMany",
    async (args: any) => args?.where?.id?.in
      ? state.rows.filter((p: any) => args.where.id.in.includes(p.id))
      : state.rows);
  replaceQuery(
    t,
    prisma.transaction,
    "updateMany",
    async ({ where, data }: any) => {
      for (const p of state.rows.filter((p: any) => where.id.in.includes(p.id))) {
        Object.assign(p, data);
        p.category = state.categories.find((c: any) => c.id === data.categoryId) || null;
      }
      return {};
    });
  replaceQuery(
    t,
    prisma.categoryCorrection,
    "createMany",
    async ({ data }: any) => {
      state.corrections.push(...data);
      return {};
    });
  replaceQuery(
    t,
    prisma.transaction,
    "update",
    async ({ where, data }: any) => {
      const p = state.rows.find((p: any) => p.id === where.id);
      Object.assign(p, data);
      if ("categoryId" in data)
        p.category = state.categories.find((c: any) => c.id === data.categoryId) || null;
      return p;
    });
  replaceQuery(
    t,
    prisma.transactionTag,
    "deleteMany",
    async ({ where }: any) => {
      for (const p of state.rows)
        if (typeof where.transactionId === "string"
          ? p.id === where.transactionId
          : where.transactionId.in.includes(p.id))
          p.tags = where.categoryId ? p.tags.filter((tag: any) => tag.categoryId !== where.categoryId) : [];
      return {};
    });
  replaceQuery(
    t,
    prisma.transactionTag,
    "createMany",
    async ({ data }: any) => {
      for (const tag of data) {
        const p = state.rows.find((p: any) => p.id === tag.transactionId);
        p.tags.push(
          {
            ...tag,
            category: state.categories.find((c: any) => c.id === tag.categoryId)
          });
      }
      return {};
    });
  replaceQuery(
    t,
    prisma.category,
    "findMany",
    async (args: any) => args?.where?.removed === false
      ? state.categories.filter((c: any) => !c.removed)
      : state.categories);
  replaceQuery(
    t,
    prisma.category,
    "update",
    async ({ where, data }: any) => {
      const c = state.categories.find((c: any) => c.id === where.id);
      Object.assign(c, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
      return c;
    });
  replaceQuery(
    t,
    prisma.category,
    "create",
    async ({ data }: any) => {
      const c = {
        id: "fictional-category" + state.categories.length,
        icon: null,
        excludeFromTotals: false,
        side: null,
        otherSide: false,
        originalName: null,
        removed: false,
        ...data
      };
      state.categories.push(c);
      return c;
    });
  replaceQuery(
    t,
    prisma.category,
    "upsert",
    async ({ where, create, update }: any) => {
      let c = state.categories.find((c: any) => c.id === where.id);
      if (c)
        Object.assign(c, update); else {
        c = create;
        state.categories.push(c);
      }
      return c;
    });
  replaceQuery(
    t,
    prisma.category,
    "delete",
    async ({ where }: any) => {
      const i = state.categories.findIndex((c: any) => c.id === where.id);
      state.categories.splice(i, 1);
      return {};
    });
  replaceQuery(t, prisma.categoryRule, "findMany", async () => []);
  replaceQuery(
    t,
    prisma.webSettings,
    "findUnique",
    async () => state.settings ? {
      data: structuredClone(state.settings)
    } : null);
  replaceQuery(
    t,
    prisma.webSettings,
    "upsert",
    async (args: any) => {
      state.settings = structuredClone(args.update.data);
      return {};
    });
  replaceQuery(t, prisma.webUndo, "deleteMany", async () => ({}));
  replaceQuery(
    t,
    prisma.webUndo,
    "create",
    async ({ data }: any) => {
      const id = "fake-undo" + ++state.counter;
      state.undos.set(
        id,
        JSON.parse(
          JSON.stringify(
            {
              id,
              ...data
            },
            (_key, v) => v && typeof v === "object" && !Array.isArray(v)
              ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
              : v)));
      return {
        id
      };
    });
  replaceQuery(
    t,
    prisma.webUndo,
    "findUnique",
    async ({ where }: any) => state.undos.get(where.id) || null);
  replaceQuery(
    t,
    prisma.webUndo,
    "delete",
    async ({ where }: any) => {
      state.undos.delete(where.id);
      return {};
    });
  replaceQuery(
    t,
    prisma,
    "$transaction",
    async (fn: any) => {
      const before = structuredClone(
        {
          rows: state.rows,
          categories: state.categories,
          settings: state.settings
        });
      try {
        return await fn(prisma);
      } catch (error) {
        if (JSON.stringify(
          {
            rows: state.rows,
            categories: state.categories,
            settings: state.settings
          })
          !== JSON.stringify(before))
          Object.assign(state, before);
        throw error;
      }
    });
  return state;
}
const fictionalCategory = {
  id: "fake-food",
  name: "Fictional Food",
  color: "#123456",
  excludeFromTotals: false
};
const fictionalPayment = (id: string, date: string, amount: number, category = fictionalCategory) => ({
  id,
  externalId: "external-" + id,
  bookingDate: new Date(date + "T12:00Z"),
  createdAt: new Date(date + "T12:00Z"),
  amount,
  currency: "EUR",
  category,
  categoryId: category.id,
  tags: [],
  balance: null,
  description: "Fictional payment",
  counterparty: "Fictional " + id,
  raw: {}
});

test(
  "payback routes authenticate, preview oldest-first, save atomically, edit/remove and undo; stale previews refused",
  async (t) => {
    for (const path of ["/api/paybacks/preview", "/api/paybacks", "/api/paybacks/link"])
      assert.equal((await request(path, {}, jsonBody({}))).status, 401);
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const state = fakeLedger(
      t,
      [
        fictionalPayment("e1", "2026-01-01", -90),
        fictionalPayment("e2", "2026-01-02", -60),
        fictionalPayment("p", "2026-02-01", 120)
      ],
      [fictionalCategory]);
    const post = (path: string, body: object) => request(path, languageHeaders("de"), jsonBody(body));
    const body = {
      ids: ["e2", "e1"],
      others: ["p"]
    };
    const preview = await post("/api/paybacks/preview", body);
    assert.equal(preview.status, 200);
    const plan = JSON.parse(preview.body);
    assert.deepEqual(plan.plan.links.map((l: any) => [l.to, l.amount]), [["e1", 90], ["e2", 30]]);
    const saved = await post("/api/paybacks", {
      ...body,
      revision: plan.revision
    });
    assert.equal(saved.status, 200);
    const dashboard = JSON.parse((await request("/api/data", languageHeaders("en"))).body);
    assert.equal(dashboard.total.expense, 30);
    assert.equal(dashboard.total.income, 0);
    assert.equal(dashboard.byMonth["2026-01"].expense, 30);
    assert.equal(dashboard.byMonth["2026-02"].income, 0);
    assert.equal(
      (await post("/api/paybacks", {
        ...body,
        revision: plan.revision
      })).status,
      409);
    assert.equal(
      (await post("/api/paybacks/link", {
        from: "p",
        to: "e1",
        amount: 91
      })).status,
      400);
    assert.equal(
      (await post("/api/paybacks/link", {
        from: "p",
        to: "e1",
        amount: 0.001
      })).status,
      400);
    const edited = await post("/api/paybacks/link", {
      from: "p",
      to: "e1",
      amount: 45
    });
    assert.equal(edited.status, 200);
    assert.equal((await post("/api/undo", {
      undo: JSON.parse(edited.body).undo
    })).status, 200);
    assert.equal(state.settings.links.p[0].amount + state.settings.links.p[1].amount, 120);
    const removed = await post("/api/paybacks/link", {
      from: "p",
      to: "e1",
      amount: 0
    });
    assert.equal(removed.status, 200);
    assert.equal(state.settings.links.p.length, 1);
    assert.equal((await post("/api/undo", {
      undo: JSON.parse(removed.body).undo
    })).status, 200);
    assert.equal(state.settings.links.p.length, 2);
  });

test(
  "remembered names persist for future imports, payment names win, display toggle and undo preserve bank ids",
  async (t) => {
    for (const path of ["/api/names", "/api/names/display"])
      assert.equal((await request(path, {}, jsonBody({}))).status, 401);
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const state = fakeLedger(t, [fictionalPayment("one", "2026-01-01", -20)], [fictionalCategory]);
    const post = (path: string, body: object) => request(path, languageHeaders("en"), jsonBody(body));
    const data = async () => JSON.parse((await request("/api/data", languageHeaders("en"))).body);
    assert.equal(
      (await post(
        "/api/names",
        {
          ids: ["one"],
          name: " Our Fictional Shop ",
          scope: "shop"
        })).status,
      200);
    const next = {
      ...fictionalPayment("two", "2026-02-01", -30),
      counterparty: "Fictional one"
    };
    state.rows.push(next);
    assert.equal((await data()).transactions[1].place, "Our Fictional Shop");
    const rename = await post("/api/names", {
      ids: ["one"],
      name: "Gift",
      scope: "payment"
    });
    assert.equal(rename.status, 200);
    assert.equal((await data()).transactions[0].place, "Gift");
    assert.equal((await post("/api/undo", {
      undo: JSON.parse(rename.body).undo
    })).status, 200);
    assert.equal((await data()).transactions[0].place, "Our Fictional Shop");
    assert.equal((await post("/api/names/display", {
      enabled: false
    })).status, 200);
    assert.equal((await data()).transactions[0].place, "Fictional one");
    assert.equal(state.rows[0].externalId, "external-one");
    for (const language of ["en", "de"])
      assert.equal(
        (await request(
          "/api/names",
          languageHeaders(language),
          jsonBody({
            name: 3,
            ids: ["one"],
            scope: "shop"
          }))).status,
        400);
  });

test(
  "batch change previews shop peers once, keeps manual choices, learns "
  + "bank identities, and undo restores category/tags/links",
  async (t) => {
    for (const path of ["/api/selection", "/api/transactions"])
      assert.equal((await request(path, {}, jsonBody({}))).status, 401);
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const target = {
      ...fictionalCategory,
      id: "fake-target",
      name: "Fictional Target"
    };
    const transfer = {
      ...fictionalCategory,
      id: "fake-transfer",
      name: "Transfer",
      excludeFromTotals: true
    };
    const rows = [
      fictionalPayment("a", "2026-01-01", -90),
      {
        ...fictionalPayment("peer", "2026-01-02", -60),
        counterparty: "Fictional a"
      },
      {
        ...fictionalPayment("manual", "2026-01-03", -30),
        counterparty: "Fictional a",
        categorySource: "manual"
      },
      fictionalPayment("in", "2026-01-04", 45)
    ];
    const state = fakeLedger(t, rows, [fictionalCategory, target, transfer]);
    state.settings = {
      links: {
        in: [{
          payment: "a",
          amount: 45
        }]
      }
    };
    const post = (path: string, body: object) => request(path, languageHeaders("en"), jsonBody(body));
    const preview = JSON.parse((await post("/api/selection", {
      ids: ["a"],
      category: target.name
    })).body);
    assert.equal(preview.total, 45);
    assert.equal(preview.otherCount, 1);
    assert.deepEqual(preview.otherIDs, ["peer"]);
    const switched = await post(
      "/api/transactions",
      {
        ids: ["a"],
        categories: [target.name],
        mode: "switch",
        otherPayments: true,
        revision: preview.revision
      });
    assert.equal(switched.status, 200);
    assert.equal(rows[0].categoryId, target.id);
    assert.equal(rows[1].categoryId, target.id);
    assert.equal(rows[2].categoryId, fictionalCategory.id);
    assert.equal(state.settings.learned["fictional a"].spend, target.id);
    assert.equal((await post("/api/undo", {
      undo: JSON.parse(switched.body).undo
    })).status, 200);
    assert.equal(rows[0].categoryId, fictionalCategory.id);
    assert.equal(rows[1].categoryId, fictionalCategory.id);
    assert.equal(state.corrections.at(-1).toCategory, fictionalCategory.name);
    const added = await post(
      "/api/transactions",
      {
        ids: ["a", "peer"],
        categories: [target.name],
        mode: "add"
      });
    assert.equal(added.status, 200);
    assert.equal(rows[0].tags.length, 1);
    assert.equal((await post("/api/undo", {
      undo: JSON.parse(added.body).undo
    })).status, 200);
    assert.equal(rows[0].tags.length, 0);
    const moved = await post(
      "/api/transactions",
      {
        ids: ["a"],
        categories: ["Transfer"],
        mode: "switch"
      });
    assert.equal(moved.status, 200);
    assert.equal(state.settings.links.in.length, 0);
    assert.equal((await post("/api/undo", {
      undo: JSON.parse(moved.body).undo
    })).status, 200);
    assert.equal(state.settings.links.in[0].payment, "a");
  });

test(
  "quick sort only changes the current unsorted name/direction, learns, skips sorted peers, and undo restores",
  async (t) => {
    assert.equal((await request("/api/quick-sort", {}, jsonBody({}))).status, 401);
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const unsorted = (id: string, amount: number) => ({
      ...fictionalPayment(id, "2026-01-01", amount),
      counterparty: "Fictional Group",
      category: null,
      categoryId: null
    });
    const rows = [
      unsorted("a", -10),
      unsorted("b", -20),
      unsorted("in", 50),
      {
        ...fictionalPayment("sorted", "2026-01-01", -30),
        counterparty: "Fictional Group"
      }
    ];
    const state = fakeLedger(t, rows, [fictionalCategory]);
    const data = JSON.parse((await request("/api/data", languageHeaders("en"))).body);
    const group = data.quickSort[0];
    assert.equal(group.count, 2);
    const body = {
      key: group.key,
      ids: group.ids,
      category: fictionalCategory.name
    };
    const saved = await request("/api/quick-sort", languageHeaders("en"), jsonBody(body));
    assert.equal(saved.status, 200);
    assert.equal(state.rows[0].categoryId, fictionalCategory.id);
    assert.equal(state.rows[2].categoryId, null);
    assert.equal(state.rows[3].categoryId, fictionalCategory.id);
    assert.equal((await request("/api/quick-sort", languageHeaders("en"), jsonBody(body))).status, 409);
    assert.equal(
      (await request(
        "/api/undo",
        languageHeaders("en"),
        jsonBody({
          undo: JSON.parse(saved.body).undo
        }))).status,
      200);
    assert.equal(state.rows[0].categoryId, null);
    assert.equal(Object.keys(state.settings.learned).length, 0);
  });

test(
  "category API requires login; creates or reuses both languages, pins "
  + "sides, renames, removes/restores defaults, and undoes",
  async (t) => {
    assert.equal((await request("/api/categories", {}, jsonBody({}))).status, 401);
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const groceries = {
      ...fictionalCategory,
      id: "fictional-groceries",
      name: "Groceries",
      icon: "ShoppingCart",
      originalName: null as string | null,
      side: "spend",
      removed: false
    };
    const custom = {
      ...fictionalCategory,
      name: "Fictional Hobby",
      side: "spend",
      removed: false
    };
    const rows = [
      fictionalPayment("known", "2026-01-01", -20, custom),
      fictionalPayment("unknown", "2026-01-02", -30, custom)
    ];
    rows[0].counterparty = "REWE";
    const state = fakeLedger(t, rows, [custom, groceries]);
    const post = (body: object) => request("/api/categories", languageHeaders("de"), jsonBody(body));
    const data = async () => JSON.parse((await request("/api/data", languageHeaders("en"))).body);
    for (const name of ["", " ", "Not sorted", "Nicht sortiert", "Cash", "Bargeld"])
      assert.equal(
        (await post({
          action: "create",
          name,
          side: "spend"
        })).status,
        400);
    const existing = await post({
      action: "create",
      name: "Lebensmittel",
      side: "income"
    });
    assert.equal(existing.status, 200);
    assert.equal(JSON.parse(existing.body).category.id, groceries.id);
    assert.equal((await data()).pick.income.includes("Groceries"), true);
    const created = await post({
      action: "create",
      name: "Fictional Garden",
      side: "income"
    });
    assert.equal(created.status, 200);
    const category = JSON.parse(created.body).category;
    assert.equal(category.side, "income");
    assert.ok(category.icon);
    assert.notEqual(category.icon, "Tag");
    const renamed = await post({
      action: "rename",
      id: groceries.id,
      name: "Fictional Pantry"
    });
    assert.equal(renamed.status, 200);
    assert.equal(groceries.originalName, "Groceries");
    assert.equal(
      (await post({
        action: "rename",
        id: groceries.id,
        original: true
      })).status,
      200);
    assert.equal(groceries.name, "Groceries");
    const deleted = await post({
      action: "delete",
      id: custom.id
    });
    assert.equal(deleted.status, 200);
    assert.equal(rows[0].categoryId, groceries.id);
    assert.equal(rows[1].categoryId, null);
    assert.equal(
      (await request(
        "/api/undo",
        languageHeaders("en"),
        jsonBody({
          undo: JSON.parse(deleted.body).undo
        }))).status,
      200);
    assert.equal(rows[0].categoryId, custom.id);
    assert.equal(rows[1].categoryId, custom.id);
    assert.ok(state.categories.some((c: any) => c.id === custom.id));
    const removed = await post({
      action: "delete",
      id: groceries.id
    });
    assert.equal(removed.status, 200);
    assert.equal(groceries.removed, true);
    assert.equal((await post({
      action: "restore",
      id: groceries.id
    })).status, 200);
    assert.equal(groceries.removed, false);
    assert.equal(
      (await post(
        {
          action: "side",
          id: category.id,
          side: "spend",
          otherSide: true
        })).status,
      200);
    assert.equal((await data()).pick.spend.includes(category.name), true);
  });

test(
  "manual cash validates login and cents, counts a gift and spending once, supports edit/delete/undo and name grouping",
  async (t) => {
    assert.equal((await request("/api/cash", {}, jsonBody({}))).status, 401);
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const state = fakeLedger(t, [fictionalPayment("bank", "2026-01-01", -10)], [fictionalCategory]);
    const post = (body: object) => request("/api/cash", languageHeaders("de"), jsonBody(body));
    const data = async () => JSON.parse((await request("/api/data", languageHeaders("en"))).body);
    for (const patch of [
      {
        total: 0.001
      },
      {
        total: -1
      },
      {
        date: "2026-02-30"
      },
      {
        direction: "wrong"
      }
    ])
      assert.equal(
        (await post(
          {
            action: "create",
            shop: "Fictional Cash",
            date: "2026-01-02",
            total: 50,
            direction: "in",
            category: fictionalCategory.name,
            ...patch
          })).status,
        400);
    const gift = await post(
      {
        action: "create",
        shop: "Fictional Cash",
        date: "2026-01-02",
        total: 50,
        direction: "in",
        category: fictionalCategory.name
      });
    assert.equal(gift.status, 200);
    const source = state.settings.cashEntries[0].id;
    const spent = await post(
      {
        action: "create",
        shop: "Fictional Cash",
        date: "2026-01-03",
        total: 20,
        direction: "out",
        category: fictionalCategory.name,
        paidFrom: source
      });
    assert.equal(spent.status, 200);
    let d = await data();
    assert.equal(d.cash.months["2026-01"].received, 50);
    assert.equal(d.cash.months["2026-01"].spent, 20);
    assert.equal(d.total.expense, 30);
    assert.equal(d.total.income, 50);
    const entry = state.settings.cashEntries.find((p: any) => p.direction === "out");
    assert.equal(d.transactions.find((p: any) => p.id === entry.id).paybackEligible, false);
    assert.equal(Object.values(d.nameGroups).some((g: any) => g.rows.includes(entry.id)), true);
    const edit = await post({
      ...entry,
      action: "edit",
      total: 25
    });
    assert.equal(edit.status, 200);
    d = await data();
    assert.equal(d.total.expense, 35);
    assert.equal(
      (await request(
        "/api/undo",
        languageHeaders("en"),
        jsonBody({
          undo: JSON.parse(edit.body).undo
        }))).status,
      200);
    assert.equal((await data()).total.expense, 30);
    const deleted = await post({
      action: "delete",
      id: entry.id
    });
    assert.equal(deleted.status, 200);
    assert.equal((await data()).total.expense, 10);
    assert.equal(
      (await request(
        "/api/undo",
        languageHeaders("en"),
        jsonBody({
          undo: JSON.parse(deleted.body).undo
        }))).status,
      200);
    assert.equal((await data()).total.expense, 30);
  });

test(
  "new mutation routes refuse GET after authentication and expose no state",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    for (const path of [
      "/api/fixed-costs",
      "/api/undo",
      "/api/paybacks/preview",
      "/api/paybacks",
      "/api/paybacks/link",
      "/api/names",
      "/api/names/display",
      "/api/selection",
      "/api/transactions",
      "/api/quick-sort",
      "/api/categories",
      "/api/cash"
    ]) {
      const result = await request(path, languageHeaders("de"));
      assert.equal(result.status, 405);
      assert.equal(result.headers.allow, "POST");
      assert.equal(result.headers["content-language"], "de");
    }
  });

test(
  "remembered category rules apply only to fresh eligible imports, "
  + "including shop aliases; manual choices and transfers stay",
  async (t) => {
    const target = {
      ...fictionalCategory,
      id: "fictional-tools",
      name: "Fictional Tools"
    };
    const transfer = {
      ...fictionalCategory,
      id: "fictional-transfer",
      name: "Transfer",
      excludeFromTotals: true
    };
    const rows = [
      {
        ...fictionalPayment("fresh", "2026-01-01", -20),
        counterparty: "Apple Services",
        categorySource: "rule"
      },
      {
        ...fictionalPayment("manual", "2026-01-01", -20),
        counterparty: "Apple Services",
        categorySource: "manual"
      },
      {
        ...fictionalPayment("transfer", "2026-01-01", -20, transfer),
        counterparty: "Apple Services",
        categorySource: "rule"
      },
      {
        ...fictionalPayment("existing", "2026-01-01", -20),
        counterparty: "Apple Services",
        categorySource: "rule"
      },
    ];
    fakeLedger(t, rows, [fictionalCategory, target, transfer]).settings = {
      learned: {
        "apple store": {
          spend: target.id
        }
      }
    };
    const { applyRememberedForImports } = await import("../data/web-ledger.js");
    await applyRememberedForImports(["fresh", "manual", "transfer"]);
    assert.equal(rows[0].categoryId, target.id);
    assert.equal(rows[0].categorySource, "rule");
    assert.equal(rows[0].externalId, "external-fresh");
    assert.equal(rows[1].categoryId, fictionalCategory.id);
    assert.equal(rows[2].categoryId, transfer.id);
    assert.equal(rows[3].categoryId, fictionalCategory.id);
  });

test(
  "Add can remove existing extra categories without moving the primary or changing headline money",
  async (t) => {
    t.mock.method(globalThis, "fetch", async () => authResponse(200));
    const extra = {
      ...fictionalCategory,
      id: "fictional-extra",
      name: "Fictional Extra"
    };
    const row = fictionalPayment("tagged", "2026-01-01", -20);
    const state = fakeLedger(t, [row], [fictionalCategory, extra]);
    state.rows[0].tags = [{
      transactionId: row.id,
      categoryId: extra.id,
      category: extra
    }];
    const result = await request(
      "/api/transactions",
      languageHeaders("en"),
      jsonBody(
        {
          ids: [row.id],
          mode: "add",
          categories: [],
          removeCategories: [extra.name]
        }));
    assert.equal(result.status, 200);
    assert.equal(row.categoryId, fictionalCategory.id);
    assert.equal(row.tags.length, 0);
    const data = JSON.parse((await request("/api/data", languageHeaders("en"))).body);
    assert.equal(data.total.expense, 20);
    assert.equal(
      (await request(
        "/api/undo",
        languageHeaders("en"),
        jsonBody({
          undo: JSON.parse(result.body).undo
        }))).status,
      200);
    assert.equal(row.tags.length, 1);
  });
