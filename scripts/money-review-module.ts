// Compile a historical calculation without checking out files or touching another worktree.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export const MONEY_REVIEW_BASE = "aaf3443c524f50808cfe8ced94379269c3181f23";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export interface MoneyModule {
  buildDashboardSource: typeof import("../src/engine/source.js").buildDashboardSource;
  buildDashboard: typeof import("../src/data/dashboard.js").buildDashboard;
  buildLedgerDashboard: typeof import("../src/engine/ledger-dashboard.js").buildLedgerDashboard;
  buildSampleSource: typeof import("../src/data/sample-source.js").buildSampleSource;
  buildWebSample: typeof import("../src/data/web-sample.js").buildWebSample;
  dashboardInputFromRows: typeof import("../src/data/queries.js").dashboardInputFromRows;
  webDashboard: typeof import("../src/data/web-ledger.js").webDashboard;
  readSettings: typeof import("../src/data/web-ledger.js").readSettings;
  pulseLine: typeof import("../src/data/pulse.js").pulseLine;
  prisma: typeof import("../src/lib/db.js").prisma;
}

export async function moneyReviewModule(revision = MONEY_REVIEW_BASE) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Use a full commit id for the baseline");
  await mkdir(resolve(root, "build"), { recursive: true });
  const directory = await mkdtemp(resolve(root, "build/money-review-"));
  try {
    const result = await build({
      stdin: {
        contents: [
          'export { buildDashboardSource } from "./src/engine/source.ts";',
          'export { buildDashboard } from "./src/data/dashboard.ts";',
          'export { buildLedgerDashboard } from "./src/engine/ledger-dashboard.ts";',
          'export { buildSampleSource } from "./src/data/sample-source.ts";',
          'export { buildWebSample } from "./src/data/web-sample.ts";',
          'export { dashboardInputFromRows } from "./src/data/queries.ts";',
          'export { webDashboard, readSettings } from "./src/data/web-ledger.ts";',
          'export { pulseLine } from "./src/data/pulse.ts";',
          'export { prisma } from "./src/lib/db.ts";',
        ].join("\n"),
        resolveDir: root, loader: "ts",
      },
      bundle: true, platform: "node", format: "esm", packages: "external", write: false,
      plugins: [{
        name: "historical-source",
        setup(builder) {
          builder.onLoad({ filter: /\.(ts|json)$/ }, ({ path }) => {
            const name = relative(root, path).split("\\").join("/");
            if (!name.startsWith("src/")) return;
            return {
              contents: execFileSync("git", ["show", `${revision}:${name}`], {
                cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
              }),
              loader: path.endsWith(".json") ? "json" : "ts",
            };
          });
        },
      }],
    });
    const file = resolve(directory, "baseline.mjs");
    await writeFile(file, result.outputFiles[0].text, { mode: 0o600 });
    const module = await import(pathToFileURL(file).href) as MoneyModule;
    return {
      module,
      async close() {
        await module.prisma.$disconnect();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
