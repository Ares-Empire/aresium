// Tiny zero-dependency web server for the dashboard: serves web/public statically and
// exposes GET /api/data → getDashboardData() (live aggregation over Postgres). No bundler
// needed — the front-end uses React + Babel-standalone from a CDN, so editing the .jsx in
// web/public/app is instant. Run: npm run web   (then open http://localhost:5173)
import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import { prisma } from "../lib/db.js";
import { getDashboardData } from "../data/queries.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "../../web/public");
const PORT = Number(process.env.PORT) || 5173;

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

server.listen(PORT, () => {
  console.log(`Aresium dashboard → http://localhost:${PORT}`);
  console.log(`(serving ${PUBLIC})`);
});

process.on("SIGINT", async () => { await prisma.$disconnect(); process.exit(0); });
