// Parser for PayPal's "Aktivitäten herunterladen" CSV export (EN + DE locales).
// If the export has unexpected headers, it throws and prints what it found.
import { parse } from "csv-parse/sync";
import { parseAmount, parseDateFlexible, pick } from "./util.js";
import type { NormalizedTxn, ParsedFile } from "./types.js";

const COLS = {
  date: ["Date", "Datum"],
  name: ["Name"],
  type: ["Type", "Typ"],
  currency: ["Currency", "Währung", "Waehrung"],
  net: ["Net", "Netto"],
  gross: ["Gross", "Brutto"],
  id: ["Transaction ID", "Transaktionscode", "Transaktions-ID"],
  from: ["From Email Address", "Absender E-Mail-Adresse"],
};

export function parsePaypalCsv(content: string): ParsedFile {
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (rows.length === 0) {
    return { source: "paypal", account: { name: "PayPal", currency: "EUR" }, transactions: [] };
  }

  const headers = Object.keys(rows[0]);
  const hasId = COLS.id.some((c) => headers.includes(c));
  const hasAmount = [...COLS.net, ...COLS.gross].some((c) => headers.includes(c));
  if (!hasId || !hasAmount) {
    throw new Error(
      `PayPal CSV: missing required columns.\nFound headers: ${headers.join(", ")}\n` +
        `Send me this header line and I'll add the mapping.`,
    );
  }

  let currency = "EUR";
  const transactions: NormalizedTxn[] = [];
  for (const row of rows) {
    const id = pick(row, COLS.id);
    if (!id) continue;
    const ccy = pick(row, COLS.currency) || "EUR";
    currency = ccy;
    const name = pick(row, COLS.name) || "";
    const type = pick(row, COLS.type) || "PayPal";
    transactions.push({
      externalId: id,
      bookingDate: parseDateFlexible(pick(row, COLS.date) ?? ""),
      amount: parseAmount(pick(row, COLS.net) ?? pick(row, COLS.gross) ?? "0"),
      currency: ccy,
      description: [type, name].filter(Boolean).join(" · ") || "PayPal transaction",
      counterparty: name || pick(row, COLS.from) || null,
      raw: row,
    });
  }

  return { source: "paypal", account: { name: "PayPal", currency }, transactions };
}
