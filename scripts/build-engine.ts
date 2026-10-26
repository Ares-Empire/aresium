import { build } from "esbuild";
import { builtinModules } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSampleSource } from "../src/data/sample-source.js";
import type { DashboardSource, Month, SourceTxn } from "../src/data/dashboard.js";
import { parseVrBankCsv } from "../src/import/vrbank-csv.js";
import { parseCamt } from "../src/import/camt.js";
import { parsePaypalCsv } from "../src/import/paypal-csv.js";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);

export async function bundleEngine(): Promise<string> {
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
  const result = await build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ["src/engine/index.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__AresiumEngine",
    footer: { js: "globalThis.AresiumEngine = __AresiumEngine;" },
    platform: "browser",
    target: "es2020",
    // Same CSV parser, using its self-contained browser distribution (no Node Buffer).
    alias: { "csv-parse/sync": "csv-parse/browser/esm/sync" },
    plugins: [{
      name: "reject-node-builtins",
      setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path }) => {
          if (path.startsWith("node:") || builtins.has(path)) {
            return { errors: [{ text: `Node built-in is forbidden in the engine: ${path}` }] };
          }
          return undefined;
        });
      },
    }],
  });
  return result.outputFiles[0].text;
}

// Entirely fictional, stable input: 5,000 transactions spanning Jan 2024–Dec 2025.
export function buildTimingSource(): DashboardSource {
  const { categories, databaseCategoryNames } = buildSampleSource();
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const months: Month[] = Array.from({ length: 24 }, (_, i) => {
    const year = 2024 + Math.floor(i / 12), month = i % 12;
    return { key: `${year}-${pad(month + 1)}`, label: `${names[month]} ${year}`, short: names[month],
      year, month, days: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(), partial: false };
  });
  const transactions: SourceTxn[] = Array.from({ length: 5000 }, (_, i) => {
    const month = months[Math.floor(i * 24 / 5000)];
    const category = categories[i % categories.length];
    const cents = 100 + (i * 7919) % 200000;
    const amount = (category.kind === "income" || i % 29 === 0 ? cents : -cents) / 100;
    return { id: `timing-${i + 1}`, date: `${month.key}-${pad(1 + i % month.days)}`, amount,
      categoryName: category.name, tags: i % 17 === 0 ? ["Travel"] : [],
      place: `Fictional Händler ${i + 1}`, city: "Sample City" };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const dayNet = new Map<string, number>();
  for (const txn of transactions) dayNet.set(txn.date, (dayNet.get(txn.date) ?? 0) + Math.round(txn.amount * 100));
  let cents = 100000;
  const balanceByDay: Record<string, number> = {};
  for (const month of months) for (let day = 1; day <= month.days; day++) {
    const date = `${month.key}-${pad(day)}`;
    cents += dayNet.get(date) ?? 0;
    balanceByDay[date] = cents / 100;
  }
  return { categories, databaseCategoryNames, months, transactions, openingBalance: 1000, balanceByDay };
}

export async function buildEngine(): Promise<void> {
  await mkdir(dist, { recursive: true });
  const bundle = await bundleEngine();
  await writeFile(new URL("aresium-engine.js", dist), bundle);
  const timing = buildTimingSource();
  for (const [name, source] of [["dashboard.sample-source.json", buildSampleSource()], ["timing-source-5000.json", timing]] as const) {
    await writeFile(new URL(name, dist), JSON.stringify(source) + "\n");
  }
  const csv = ["Buchungstag;Valutadatum;Name Zahlungsbeteiligter;Verwendungszweck;Betrag;Währung",
    ...timing.transactions.map((txn) => `${txn.date};${txn.date};${txn.place};Fictional Zahlung ${txn.id};${txn.amount.toFixed(2).replace(".", ",")};EUR`),
  ].join("\n") + "\n";
  await writeFile(new URL("timing-vr-5000.csv", dist), csv);
  // Oracles come from the server imports, not from the bundle under test.
  for (const [name, parser] of [["vrbank.csv", parseVrBankCsv], ["camt.xml", parseCamt], ["paypal.csv", parsePaypalCsv]] as const) {
    const file = new URL(`src/engine/fixtures/${name}`, root);
    const input = await readFile(file, "utf8");
    await writeFile(new URL(`${file.href}.expected.json`), JSON.stringify(parser(input), null, 2) + "\n");
  }
  console.log(`Wrote dist/aresium-engine.js (${Buffer.byteLength(bundle)} bytes), sample source, timing sources and parser answers`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await buildEngine();
