// Reusable import core — parse a single export's *content* (not a path) and ingest it
// idempotently. Extracted from run.ts so both the CLI (run.ts) and the web server's
// POST /api/import can share one code path with no side effects on import.
//
// Idempotent: every transaction is keyed on (source, externalId), so re-importing
// overlapping date ranges only adds genuinely new rows.
import { extname } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { parseCamt } from "./camt.js";
import { parsePaypalCsv } from "./paypal-csv.js";
import { parseVrBankCsv } from "./vrbank-csv.js";
import type { ParsedFile } from "./types.js";

export function looksLikePaypal(content: string): boolean {
  const head = (content.split(/\r?\n/)[0] ?? "").toLowerCase();
  return (
    head.includes("transaction id") ||
    head.includes("transaktionscode") ||
    head.includes("netto") ||
    /(^|[,;"])net([,;"]|$)/.test(head)
  );
}

// Parse by extension; CSV type (VR Bank vs PayPal) is auto-detected from the header.
export function parseContent(filename: string, content: string): ParsedFile | null {
  const ext = extname(filename).toLowerCase();
  if (ext === ".xml") return parseCamt(content);
  if (ext === ".csv") return looksLikePaypal(content) ? parsePaypalCsv(content) : parseVrBankCsv(content);
  return null;
}

export async function ingest(parsed: ParsedFile): Promise<{ added: number; total: number }> {
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

export type ImportResult = { name: string; added: number; total: number; account: string | null; skipped: boolean };

// Parse + ingest one file's content. Does NOT categorise — callers run categorizeAll()
// once after a batch (it's a whole-table pass, wasteful to repeat per file).
export async function importContent(filename: string, content: string): Promise<ImportResult> {
  const parsed = parseContent(filename, content);
  if (!parsed) return { name: filename, added: 0, total: 0, account: null, skipped: true };
  const { added, total } = await ingest(parsed);
  return { name: filename, added, total, account: parsed.account.name, skipped: false };
}
