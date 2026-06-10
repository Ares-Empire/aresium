// Import runner. Scans a folder (default ./imports) for bank exports (CAMT .xml,
// VR Bank .csv) and PayPal exports (.csv), loads them into Postgres, then categorises.
//
//   npm run import            # reads ./imports
//   npm run import -- path     # reads a custom folder
//
// Idempotent: every transaction is keyed on (source, externalId), so re-importing
// overlapping date ranges only adds genuinely new rows.
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { parseCamt } from "./camt.js";
import { parsePaypalCsv } from "./paypal-csv.js";
import { parseVrBankCsv } from "./vrbank-csv.js";
import { categorizeAll } from "../sync/categorize.js";
import type { ParsedFile } from "./types.js";

const IMPORT_DIR = process.argv[2] || "imports";

function looksLikePaypal(content: string): boolean {
  const head = (content.split(/\r?\n/)[0] ?? "").toLowerCase();
  return (
    head.includes("transaction id") ||
    head.includes("transaktionscode") ||
    head.includes("netto") ||
    /(^|[,;"])net([,;"]|$)/.test(head)
  );
}

function parseFile(path: string): ParsedFile | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".xml") return parseCamt(readFileSync(path, "utf8"));
  if (ext === ".csv") {
    const content = readFileSync(path, "utf8");
    return looksLikePaypal(content) ? parsePaypalCsv(content) : parseVrBankCsv(content);
  }
  return null;
}

async function ingest(parsed: ParsedFile): Promise<{ added: number; total: number }> {
  const externalId = parsed.account.iban || `${parsed.source}-default`;
  const account = await prisma.account.upsert({
    where: { source_externalId: { source: parsed.source, externalId } },
    create: {
      source: parsed.source,
      externalId,
      name: parsed.account.name,
      iban: parsed.account.iban,
      currency: parsed.account.currency,
    },
    update: { name: parsed.account.name, iban: parsed.account.iban },
  });

  const ids = parsed.transactions.map((t) => t.externalId);
  const existing = new Set(
    (
      await prisma.transaction.findMany({
        where: { source: parsed.source, externalId: { in: ids } },
        select: { externalId: true },
      })
    ).map((r) => r.externalId),
  );
  const fresh = parsed.transactions.filter((t) => !existing.has(t.externalId));

  if (fresh.length > 0) {
    await prisma.transaction.createMany({
      data: fresh.map((t) => ({
        accountId: account.id,
        source: parsed.source,
        externalId: t.externalId,
        bookingDate: t.bookingDate,
        valueDate: t.valueDate ?? null,
        amount: t.amount,
        balance: t.balance ?? null,
        currency: t.currency,
        description: t.description,
        counterparty: t.counterparty ?? null,
        raw: (t.raw ?? {}) as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  return { added: fresh.length, total: parsed.transactions.length };
}

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
      const parsed = parseFile(join(IMPORT_DIR, file));
      if (!parsed) {
        console.log(`• ${file}: skipped (unknown type)`);
        continue;
      }
      const { added, total } = await ingest(parsed);
      console.log(`• ${file}: ${added} new / ${total} parsed → ${parsed.account.name}`);
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
