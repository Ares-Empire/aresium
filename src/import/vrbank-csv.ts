// Parser for VR Bank / Volksbank "Umsätze exportieren → CSV" (semicolon-delimited,
// German number/date format). Column names vary between VR branches/versions, so we
// match against several candidates. If the amount column can't be found, it throws
// and prints the headers so the mapping can be extended.
import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { parseAmount, parseDateFlexible, pick } from "./util.js";
import type { NormalizedTxn, ParsedFile } from "./types.js";

const COLS = {
  ownIban: ["IBAN Auftragskonto", "Auftragskonto", "Kontonummer Auftragskonto"],
  booking: ["Buchungstag", "Buchung", "Buchungsdatum"],
  value: ["Valutadatum", "Wertstellung", "Valuta"],
  name: [
    "Name Zahlungsbeteiligter",
    "Beguenstigter/Zahlungspflichtiger",
    "Begünstigter/Zahlungspflichtiger",
    "Auftraggeber/Empfänger",
    "Empfänger/Zahlungspflichtiger",
    "Zahlungsbeteiligter",
  ],
  bookingText: ["Buchungstext", "Buchungsart", "Umsatzart", "Vorgang"],
  purpose: ["Verwendungszweck", "Vorgang/Verwendungszweck", "Verwendungszweck 1"],
  amount: ["Betrag", "Umsatz", "Betrag (EUR)"],
  currency: ["Waehrung", "Währung"],
  sign: ["Soll/Haben", "S/H", "Soll-/Haben", "Soll-/Habenkennzeichen"],
};

// VR exports are usually ";"-delimited, but tolerate "," just in case.
function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/)[0] ?? "";
  return (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

export function parseVrBankCsv(content: string): ParsedFile {
  const rows = parse(content, {
    columns: true,
    delimiter: detectDelimiter(content),
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  if (rows.length === 0) {
    return { source: "bank", account: { name: "VR Bank", currency: "EUR" }, transactions: [] };
  }

  const headers = Object.keys(rows[0]);
  const hasAmount = COLS.amount.some((c) => headers.includes(c));
  const hasDate = COLS.booking.some((c) => headers.includes(c));
  if (!hasAmount || !hasDate) {
    throw new Error(
      `VR Bank CSV: missing required columns.\nFound headers: ${headers.join(" | ")}\n` +
        `Send me this header line and I'll add the mapping.`,
    );
  }

  let iban: string | undefined;
  let currency = "EUR";
  const transactions: NormalizedTxn[] = [];

  for (const row of rows) {
    const rawAmount = pick(row, COLS.amount);
    if (rawAmount === undefined) continue; // skip summary/blank rows
    let amount = parseAmount(rawAmount);
    const sh = pick(row, COLS.sign);
    if (sh && /^(s|d|soll)/i.test(sh) && !amount.startsWith("-")) amount = `-${amount}`;

    iban = iban || pick(row, COLS.ownIban);
    const ccy = pick(row, COLS.currency) || "EUR";
    currency = ccy;
    const bookingDate = parseDateFlexible(pick(row, COLS.booking) ?? "");
    const valueRaw = pick(row, COLS.value);
    const purpose = pick(row, COLS.purpose) || pick(row, COLS.bookingText) || "(no description)";
    const counterparty = pick(row, COLS.name) || null;

    const externalId = createHash("sha1")
      .update(`${bookingDate.toISOString()}|${amount}|${purpose}|${counterparty ?? ""}`)
      .digest("hex")
      .slice(0, 24);

    transactions.push({
      externalId,
      bookingDate,
      valueDate: valueRaw ? parseDateFlexible(valueRaw) : null,
      amount,
      currency: ccy,
      description: purpose,
      counterparty,
      raw: row,
    });
  }

  return {
    source: "bank",
    account: { name: iban ? `VR Bank ••${iban.slice(-4)}` : "VR Bank", iban, currency },
    transactions,
  };
}
