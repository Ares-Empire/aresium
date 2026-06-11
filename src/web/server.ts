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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

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
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/data") {
      const data = await getDashboardData();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
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
