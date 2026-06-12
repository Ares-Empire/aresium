// Tiny zero-dependency web server for the dashboard: serves web/public statically and
// exposes GET /api/data → getDashboardData() (live aggregation over Postgres). No bundler
// needed — the front-end uses React + Babel-standalone from a CDN, so editing the .jsx in
// web/public/app is instant. Run: npm run web   (then open http://localhost:5173)
import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import { prisma } from "../lib/db.js";
import { getDashboardData, getTransactionDetail, recategorizeTransaction } from "../data/queries.js";
import { importContent } from "../import/core.js";
import { categorizeAll } from "../sync/categorize.js";
import { authEnabled, hasValidSession, verifyPassword, sessionCookie, clearCookie } from "./auth.js";
import { loginPage } from "./login-page.js";

// `max` caps the buffered body (bytes); on overflow the request is destroyed and the
// promise resolves "" so the handler reports a clean error. Uploads need a larger cap
// than the small JSON the rest of the API takes.
function readBody(req: IncomingMessage, max = 1e6): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > max) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

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
  ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // ---- authentication (single password + signed session cookie) ----
    // GET /login → page; POST /login → set cookie; /logout → clear. Everything else is
    // gated when auth is configured. /login & /logout must stay reachable unauthenticated.
    if (url.pathname === "/login" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(loginPage());
      return;
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const password = new URLSearchParams(await readBody(req)).get("password") ?? "";
      if (verifyPassword(password)) {
        res.writeHead(303, { "Set-Cookie": sessionCookie(), Location: "/" });
        res.end();
      } else {
        await new Promise((r) => setTimeout(r, 500)); // small delay slows brute-forcing
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(loginPage("Incorrect password."));
      }
      return;
    }
    if (url.pathname === "/logout") {
      res.writeHead(303, { "Set-Cookie": clearCookie(), Location: "/login" });
      res.end();
      return;
    }
    // gate every other route once auth is configured
    if (authEnabled() && !hasValidSession(req.headers.cookie)) {
      if (url.pathname.startsWith("/api/")) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "unauthenticated" }));
      } else {
        res.writeHead(303, { Location: "/login" });
        res.end();
      }
      return;
    }

    if (url.pathname === "/api/data") {
      const data = await getDashboardData();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
      return;
    }

    // POST /api/import  → ingest uploaded bank/PayPal exports, then categorise.
    // Body: { files: [{ name, content }] }. The front-end reads files as text, so this
    // is plain JSON (no multipart). Same auth gate as the rest of the site.
    if (req.method === "POST" && url.pathname === "/api/import") {
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      if (importing) { res.writeHead(409, headers); res.end(JSON.stringify({ error: "an import is already running" })); return; }
      let body: { files?: Array<{ name?: string; content?: string }> };
      try { body = JSON.parse(await readBody(req, IMPORT_MAX_BYTES)); } catch { body = {}; }
      const files = Array.isArray(body.files) ? body.files : [];
      const valid = files.filter((f) => f && typeof f.name === "string" && typeof f.content === "string" && /\.(csv|xml)$/i.test(f.name));
      if (valid.length === 0) { res.writeHead(400, headers); res.end(JSON.stringify({ error: "no .csv/.xml files in request" })); return; }

      importing = true;
      try {
        const results = [];
        for (const f of valid) {
          try {
            results.push(await importContent(f.name as string, f.content as string));
          } catch (e) {
            results.push({ name: f.name, added: 0, total: 0, account: null, skipped: false, error: (e as Error).message });
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
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      let category: string | undefined;
      try { category = JSON.parse(await readBody(req)).category; } catch { /* invalid body */ }
      if (!id || !category) { res.writeHead(400, headers); res.end(JSON.stringify({ error: "id and category required" })); return; }
      const result = await recategorizeTransaction(id, category);
      if ("error" in result) {
        res.writeHead(result.error === "not found" ? 404 : 400, headers);
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(result.detail));
      return;
    }

    if (url.pathname.startsWith("/api/transaction/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/transaction/".length));
      const detail = id ? await getTransactionDetail(id) : null;
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      if (!detail) { res.writeHead(404, headers); res.end(JSON.stringify({ error: "not found" })); return; }
      res.writeHead(200, headers);
      res.end(JSON.stringify(detail));
      return;
    }

    // static files (default to index.html), with traversal guard
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(PUBLIC, decodeURIComponent(rel)));
    if (!filePath.startsWith(PUBLIC)) { res.writeHead(403).end("Forbidden"); return; }

    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
    res.end(body);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") { res.writeHead(404).end("Not found"); return; }
    console.error(e);
    res.writeHead(500).end("Server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Aresium dashboard → http://localhost:${PORT}`);
  console.log(`(serving ${PUBLIC})`);
});

process.on("SIGINT", async () => { await prisma.$disconnect(); process.exit(0); });
