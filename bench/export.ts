// The only database entry point in the bench. Never run this on a developer Mac.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { entryCounterpartyIban } from "../src/engine/readers/camt.js";
import { BANK_PROFILES } from "../src/engine/readers/profiles.js";
import { recordCounterpartyIban } from "../src/engine/readers/read.js";
import { normalizeIban } from "../src/engine/readers/values.js";
import { DATA_FILE, parseData, type BenchPayment } from "./data.js";

// One stored payment, as the query below selects it.
export type ExportRow = {
  bookingDate: Date; amount: unknown; currency: string; description: string; counterparty: string | null;
  source: "bank" | "paypal"; accountId: string; account: { iban: string | null }; raw: unknown;
  category: { name: string } | null;
};

// The server imports VR Bank CSV and CAMT files. Their stored original rows are already parsed (a CSV row as
// column → cell, a CAMT entry as its XML elements), so the other party's IBAN is read from them as the engine's
// readers read it. PayPal rows have none.
const VR_PROFILES = BANK_PROFILES.filter((profile) => profile.bank === "VR Bank");
export function storedCounterpartyIban(raw: unknown): string | undefined {
  return entryCounterpartyIban(raw) ?? VR_PROFILES.map((profile) => recordCounterpartyIban(raw, profile)).find(Boolean);
}

// Stored payments → bench payments. References are sequence numbers; accounts and IBANs become local aliases
// (the same IBAN, the same alias), so the own-transfer rules can compare them without the real values.
export function benchPayments(rows: readonly ExportRow[]): BenchPayment[] {
  const accounts = new Map<string, string>(), ibans = new Map<string, string>();
  const alias = (known: Map<string, string>, kind: string, value: string) => {
    if (!known.has(value)) known.set(value, `${kind}-${known.size + 1}`);
    return known.get(value)!;
  };
  return rows.map((row, index) => {
    const accountIban = normalizeIban(row.account.iban ?? "");
    const other = row.source === "bank" ? storedCounterpartyIban(row.raw) : undefined;
    return {
      reference: `payment-${index + 1}`, date: row.bookingDate.toISOString().slice(0, 10),
      amount: Number(row.amount), description: row.description, counterparty: row.counterparty,
      trueCategory: row.category?.name ?? "",
      source: row.source, currency: row.currency, account: alias(accounts, "account", row.accountId),
      accountIban: accountIban ? alias(ibans, "iban", accountIban) : null,
      counterpartyIban: other ? alias(ibans, "iban", other) : null,
    };
  });
}

export async function exportData(): Promise<void> {
  const { prisma } = await import("../src/lib/db.js");
  try {
    const rows = await prisma.transaction.findMany({
      where: { categorySource: { in: ["rule", "manual"] } },
      select: {
        bookingDate: true, amount: true, currency: true, description: true, counterparty: true, source: true,
        accountId: true, account: { select: { iban: true } }, raw: true, category: { select: { name: true } },
      },
      orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
    });
    const payments = benchPayments(rows);
    parseData(payments);
    await mkdir(new URL("out/", import.meta.url), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(payments) + "\n", { mode: 0o600 });
    const withIban = payments.filter((p) => p.counterpartyIban).length;
    console.log(`Exported ${payments.length} answer-key payments (${withIban} with the other party's IBAN).`);
  } finally { await prisma.$disconnect(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await exportData(); } catch { console.error("Export failed; details withheld to protect payment data."); process.exitCode = 1; }
}
