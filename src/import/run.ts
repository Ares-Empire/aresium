// Import runner (CLI). Scans a folder (default ./imports) for bank exports (CAMT .xml,
// VR Bank .csv) and PayPal exports (.csv), loads them into Postgres, then categorises.
//
//   npm run import            # reads ./imports
//   npm run import -- path     # reads a custom folder
//
// The parse+ingest core lives in core.ts (shared with the web upload endpoint); this
// file is just the filesystem-facing CLI wrapper around it.
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db.js";
import { importContent } from "./core.js";
import { categorizeAll } from "../sync/categorize.js";

const IMPORT_DIR = process.argv[2] || "imports";

async function main() {
  let files: string[];
  try {
    files = readdirSync(IMPORT_DIR).filter((f) => /\.(xml|csv)$/i.test(f));
  } catch {
    throw new Error(`Import folder "${IMPORT_DIR}/" not found — create it and drop your exports in.`);
  }
  if (files.length === 0) {
    console.log(
      `No .xml/.csv files in ${IMPORT_DIR}/.\n` +
        `Drop your VR Bank (CAMT .xml or CSV) and/or PayPal (.csv) exports there, then re-run.`,
    );
    return;
  }

  for (const file of files) {
    try {
      const r = await importContent(file, readFileSync(join(IMPORT_DIR, file), "utf8"));
      if (r.skipped) { console.log(`• ${file}: skipped (unknown type)`); continue; }
      console.log(`• ${file}: ${r.added} new / ${r.total} parsed → ${r.account}`);
    } catch (e) {
      console.error(`• ${file}: ERROR — ${(e as Error).message}`);
    }
  }

  await categorizeAll();
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
