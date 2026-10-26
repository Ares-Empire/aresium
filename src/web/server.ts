// Tiny zero-dependency web server for the dashboard: serves web/public statically and
// exposes GET /api/data → buildDashboard(getDashboardSource()) (version 2). No bundler
// needed — the front-end uses React + Babel-standalone from a CDN, so editing the .jsx in
// web/public/app is instant. Run: npm run web   (then open http://localhost:5173)
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, resolve } from "node:path";
import { prisma } from "../lib/db.js";
import { buildDashboard } from "../data/dashboard.js";
import { pulseLine } from "../data/pulse.js";
import { getDashboardSource, getTransactionDetail, recategorizeTransaction, setTransactionTags } from "../data/queries.js";
import { importContent } from "../import/core.js";
import { categorizeAll } from "../sync/categorize.js";
import { sessionCookie, clearCookie, sessionToken } from "./auth.js";
import { welcomePage, loginPage, loginUnavailablePage } from "./login-page.js";
import { bearerToken, empireBearerAccess, empireLogin, empireMode, empireTokenAccess } from "./empire-auth.js";
import { requestLanguage, text } from "../lib/texts.js";
import { importErrorText } from "../import/errors.js";
import { BodyTooLargeError, readBody } from "./read-body.js";

const IMPORT_MAX_BYTES = 25 * 1024 * 1024;   // generous for a year of PayPal/VR-Bank CSV
let importing = false;                        // serialise imports (single-user tool)

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "../../web/public");
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "127.0.0.1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jsx": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
  ".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime",
};

// The demo, aresium.de/demo: the dashboard with the made-up sample data (app/dashboard.sample.json, made by
// `npm run sample`) for anyone, without an account. data.js sees the path, loads the sample instead of /api/data and
// answers the page's own requests in the browser, so nothing reaches the API and nothing is saved. The page's files
// (scripts, styles, fonts, pictures) are public for it: they hold no data. "/" stays behind the login, so made-up
// numbers never stand where your own would.
const PUBLIC_DIRS = ["/app/", "/vendor/", "/fonts/", "/brand/"];
export const isPublicFile = (path: string) => PUBLIC_DIRS.some((dir) => path.startsWith(dir)) || path === "/favicon.svg";

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Content-Language", "en"); // Website pages stay English.
  const language = requestLanguage(req.headers["accept-language"]);
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Language": language };
  const apiError = (status: number, error: string) => {
    res.writeHead(status, headers);
    res.end(JSON.stringify({ error }));
  };
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // ---- authentication: Empire accounts (see empire-auth.ts) ----
    // /login, /login/email, /sso and /logout stay reachable without a session; everything else
    // needs one. Pages need the session cookie; the API also takes a Bearer token (iPhone app).
    const html = (status: number, body: string) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Language": "en" });
      res.end(body);
    };
    const redirect = (location: string, cookie?: string) => {
      res.writeHead(303, cookie ? { "Set-Cookie": cookie, Location: location } : { Location: location });
      res.end();
    };
    // Caddy puts the visitor's address last in X-Forwarded-For.
    const clientIp = String(req.headers["x-forwarded-for"] ?? "").split(",").pop()?.trim() || undefined;
    const loggedIn = () => empireTokenAccess(sessionToken(req.headers.cookie), clientIp);

    if ((url.pathname === "/login" || url.pathname === "/login/email") && req.method === "GET") {
      const access = await loggedIn();
      if (access.outcome === "allowed") return redirect("/");
      if (access.outcome === "unavailable") return html(503, loginUnavailablePage());
      return html(200, url.pathname === "/login" ? welcomePage() : loginPage());
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req, 10_000));
      const email = (form.get("email") ?? "").trim();
      const result = await empireLogin(email, form.get("password") ?? "", clientIp);
      if ("token" in result) return redirect("/", sessionCookie(result.token));
      if (result.outcome === "unavailable") return html(503, loginUnavailablePage());
      return html(401, loginPage(result.error, email));
    }
    if (url.pathname === "/logout") return redirect("/login", clearCookie());
    // Hand-off from the hub: it POSTs the visitor's Empire token here, so there's no second login.
    if (url.pathname === "/sso") {
      if (req.method === "POST") {
        const token = new URLSearchParams(await readBody(req, 10_000)).get("token") ?? "";
        const access = await empireTokenAccess(token, clientIp);
        if (access.outcome === "allowed") return redirect("/", sessionCookie(token));
        if (access.outcome === "unavailable") return html(503, loginUnavailablePage());
        return html(401, welcomePage("Your Empire account has no access to Aresium."));
      }
      return redirect("/login");
    }

    if (req.method === "GET" || req.method === "HEAD") {
      if (url.pathname === "/demo/") return redirect("/demo");      // the page's relative paths need no slash
      if (url.pathname === "/demo") return serveFile(res, "/index.html");
      if (isPublicFile(url.pathname)) return serveFile(res, url.pathname);
    }

    // GET /api/mode → which mode the iPhone app uses for this account (docs/API-DATA.md → Mode). The one route open
    // to every approved account with the aresium service: the owner list decides the answer, not the access. The
    // app's Bearer token, else the website's session cookie. Nothing about the account is stored or logged.
    if (url.pathname === "/api/mode") {
      const authorization = req.headers.authorization;
      const mode = await empireMode(authorization === undefined ? sessionToken(req.headers.cookie) : bearerToken(authorization), clientIp);
      if (mode.outcome === "allowed") {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ mode: mode.mode }));
        return;
      }
      // The Empire's error codes (ares-empire docs/API-EMPIRE.md → Errors): the app closes only on `no_access`.
      const [key, code] = mode.status === 401 ? ["unauthenticated", "unauthorized"] as const
        : mode.status === 403 ? ["forbidden", "no_access"] as const : ["authUnavailable", "unavailable"] as const;
      res.writeHead(mode.status, headers);
      res.end(JSON.stringify({ error: text(key, language), code }));
      return;
    }

    const isApi = url.pathname.startsWith("/api/");
    let access = await loggedIn();
    if (access.outcome !== "allowed" && isApi && req.headers.authorization) {
      const bearer = await empireBearerAccess(req.headers.authorization, clientIp);
      // Either credential can grant access. If neither does, preserve an unresolved session
      // during an outage; otherwise retain an explicit account denial over a missing token.
      if (bearer.outcome === "allowed" || bearer.outcome === "unavailable"
        || (access.outcome !== "unavailable" && (bearer.status === 403 || access.status === 401))) access = bearer;
    }
    if (access.outcome !== "allowed") {
      if (isApi) {
        apiError(access.status, text(access.status === 401 ? "unauthenticated" : access.status === 403 ? "forbidden" : "authUnavailable", language));
      } else if (access.outcome === "unavailable") {
        html(503, loginUnavailablePage());
      } else {
        redirect("/login");
      }
      return;
    }

    if (url.pathname === "/api/pulse") {
      // One line for the Empire hub's Aresium card (docs/API-DATA.md); same numbers as /api/data.
      const line = pulseLine(buildDashboard(await getDashboardSource()), new Date(), language);
      res.writeHead(200, headers);
      res.end(JSON.stringify({ line }));
      return;
    }

    if (url.pathname === "/api/data") {
      const data = buildDashboard(await getDashboardSource());
      res.writeHead(200, headers);
      res.end(JSON.stringify(data));
      return;
    }

    // POST /api/import  → ingest uploaded bank/PayPal exports, then categorise.
    // Body: { files: [{ name, content }] }. The front-end reads files as text, so this
    // is plain JSON (no multipart). Same auth gate as the rest of the site.
    if (req.method === "POST" && url.pathname === "/api/import") {
      if (importing) { res.writeHead(409, headers); res.end(JSON.stringify({ error: text("importRunning", language) })); return; }
      let body: { files?: Array<{ name?: string; content?: string }> };
      try { body = JSON.parse(await readBody(req, IMPORT_MAX_BYTES)); } catch (e) {
        if (e instanceof BodyTooLargeError) {
          res.writeHead(413, headers);
          res.end(JSON.stringify({ error: text("importTooLarge", language) }));
          return;
        }
        body = {};
      }
      const files = Array.isArray(body?.files) ? body.files : [];
      const valid = files.filter((f) => f && typeof f.name === "string" && typeof f.content === "string" && /\.(csv|xml)$/i.test(f.name));
      if (valid.length === 0) { res.writeHead(400, headers); res.end(JSON.stringify({ error: text("noFiles", language) })); return; }

      importing = true;
      try {
        const results = [];
        for (const f of valid) {
          try {
            results.push(await importContent(f.name as string, f.content as string));
          } catch (e) {
            results.push({ name: f.name, added: 0, total: 0, account: null, skipped: false, error: importErrorText(e, language) });
          }
        }
        await categorizeAll();
        res.writeHead(200, headers);
        res.end(JSON.stringify({ results }));
      } finally {
        importing = false;
      }
      return;
    }

    // POST /api/transaction/:id/category  → manually recategorise + log the correction
    if (req.method === "POST" && url.pathname.startsWith("/api/transaction/") && url.pathname.endsWith("/category")) {
      const id = decodeURIComponent(url.pathname.slice("/api/transaction/".length, -"/category".length));
      let category: string | undefined;
      try { category = JSON.parse(await readBody(req)).category; } catch (e) { if (e instanceof BodyTooLargeError) throw e; /* invalid body */ }
      if (!id || !category) { res.writeHead(400, headers); res.end(JSON.stringify({ error: text("categoryRequired", language) })); return; }
      const result = await recategorizeTransaction(id, category);
      if (result.error) {
        res.writeHead(result.error === "not found" ? 404 : 400, headers);
        res.end(JSON.stringify({ error: text(result.error, language) }));
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(result.detail));
      return;
    }

    // POST /api/transaction/:id/tags  → "Add" the txn into extra categories (secondary
    // views, never re-summed into totals). { categories: string[], dropCurrent?: bool }.
    // dropCurrent moves it out of its current primary into categories[0] + tags the rest.
    if (req.method === "POST" && url.pathname.startsWith("/api/transaction/") && url.pathname.endsWith("/tags")) {
      const id = decodeURIComponent(url.pathname.slice("/api/transaction/".length, -"/tags".length));
      let categories: unknown, dropCurrent = false;
      try { const b = JSON.parse(await readBody(req)); categories = b.categories; dropCurrent = !!b.dropCurrent; } catch (e) { if (e instanceof BodyTooLargeError) throw e; /* invalid body */ }
      if (!id || !Array.isArray(categories)) { res.writeHead(400, headers); res.end(JSON.stringify({ error: text("categoriesRequired", language) })); return; }
      const result = await setTransactionTags(id, categories as string[], dropCurrent);
      if (result.error) {
        res.writeHead(result.error === "not found" ? 404 : 400, headers);
        res.end(JSON.stringify({ error: text(result.error, language) }));
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(result.detail));
      return;
    }

    if (url.pathname.startsWith("/api/transaction/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/transaction/".length));
      const detail = id ? await getTransactionDetail(id) : null;
      if (!detail) { res.writeHead(404, headers); res.end(JSON.stringify({ error: text("not found", language) })); return; }
      res.writeHead(200, headers);
      res.end(JSON.stringify(detail));
      return;
    }

    // static files (default to index.html)
    await serveFile(res, url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      apiError(413, text("requestTooLarge", language));
      return;
    }
    if (req.url?.startsWith("/api/")) {
      apiError(500, text("serverError", language));
      return;
    }
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") { res.writeHead(404).end("Not found"); return; }
    console.error(e);
    res.writeHead(500).end("Server error");
  }
}

// A file from web/public, with a traversal guard. A missing file throws ENOENT (404 in handleRequest).
async function serveFile(res: ServerResponse, rel: string): Promise<void> {
  const filePath = normalize(join(PUBLIC, decodeURIComponent(rel)));
  if (!filePath.startsWith(PUBLIC + "/")) { res.writeHead(403).end("Forbidden"); return; }
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
  res.end(body);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(handleRequest).listen(PORT, HOST, () => {
    console.log(`Aresium dashboard → http://localhost:${PORT}`);
    console.log(`(serving ${PUBLIC})`);
  });

  process.on("SIGINT", async () => { await prisma.$disconnect(); process.exit(0); });
}
