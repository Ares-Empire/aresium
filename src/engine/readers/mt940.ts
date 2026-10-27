// MT940 (SWIFT customer statement), as German banks fill it.
// Sources: SWIFT MT940 field layout (:20: :25: :28C: :60F: :61: :86: :62F:), and the German banking industry's
// rules for the :86: field, DFÜ-Abkommen Anlage 3, "Spezifikation der Datenformate", chapter on MT940
// (ebics.de): a three-digit transaction code (GVC), then subfields marked "?NN": ?00 booking text, ?10 primanota,
// ?20–?29 and ?60–?63 payment text, ?30 BIC or bank code, ?31 IBAN or account number, ?32–?33 name,
// ?34 text key extension. SEPA payments put "EREF+", "MREF+", "CRED+", "SVWZ+" (the payment text) and so on
// into the payment text (see sepaPaymentText).
//
// MT942 (intraday, with bookings not yet booked) has :34F: and :13D:; those statements are skipped.
// Ids: a hash of the booking's :61: and :86: lines plus its occurrence number (MT940's references are not
// reliable ids: the customer reference is mostly "NONREF" and the bank reference is optional).
import { bookingIds } from "./ids.js";
import { accountName, BankFileError, findIban } from "./table.js";
import { addAmounts, cleanText, negate, parseAmountStrict, sameAmount, sepaPaymentText } from "./values.js";
import type { BankAccount, BankFile, BankTxn } from "./types.js";

type Field = { tag: string; value: string };

// Splits the text into ":tag:" fields; continuation lines stay with their field.
function fields(text: string): Field[] {
  const out: Field[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) out.push({ tag: m[1], value: m[2] });
    else if (/^-}?\s*$/.test(line) || line.startsWith("{")) out.push({ tag: "end", value: "" });
    else if (out.length > 0 && out[out.length - 1].tag !== "end") out[out.length - 1].value += `\n${line}`;
  }
  return out;
}

// YYMMDD → YYYY-MM-DD (years 2000–2099, as German MT940 files are recent).
function date6(value: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

// "12,34" or "12," → canonical amount.
const amountOf = (value: string) => parseAmountStrict(value.endsWith(",") ? `${value}00` : value, "de");

// :60F: / :62F: "C240101EUR1234,56" → signed amount.
function balanceOf(value: string): { amount: string; currency: string } | null {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(value.trim());
  const amount = m ? amountOf(m[4]) : null;
  if (!m || !amount) return null;
  return { amount: m[1] === "D" ? negate(amount) : amount, currency: m[3] };
}

// :61: value date, optional entry date (MMDD), C/D/RC/RD, optional funds code, amount, type, references.
const LINE_61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+,\d*)([NFS][A-Z0-9]{3})(.*)$/;

function bookingDate(valueDate: string, entry: string | undefined): string {
  if (!entry) return valueDate;
  let year = +valueDate.slice(0, 4);
  const valueMonth = +valueDate.slice(5, 7), month = +entry.slice(0, 2);
  if (month - valueMonth > 6) year--; // booked in December, value date in January
  if (valueMonth - month > 6) year++; // booked in January, value date in December
  return `${year}-${entry.slice(0, 2)}-${entry.slice(2, 4)}`;
}

// Joins text subfields: a full 27-character subfield was cut mid-text, so the next one follows directly.
function joinSubfields(parts: string[]): string {
  let text = "";
  parts.forEach((part, i) => { text += (i > 0 && parts[i - 1].length < 27 ? " " : "") + part; });
  return text.replace(/\s+/g, " ").trim();
}

type Details = { kind: string; text: string; name: string };

function details86(value: string): Details {
  const joined = value.replace(/\n/g, "");
  const m = /^(\d{3})(\D)/.exec(joined);
  if (!m) return { kind: "", text: cleanText(joined), name: "" };
  const separator = m[2];
  const sub = new Map<string, string>();
  const parts = joined.slice(4).split(new RegExp(`\\${separator}(\\d{2})`));
  for (let i = 1; i < parts.length; i += 2) sub.set(parts[i], (sub.get(parts[i]) ?? "") + parts[i + 1]);
  const codes = (from: number, to: number) => {
    const out: string[] = [];
    for (let n = from; n <= to; n++) if (sub.has(String(n))) out.push(sub.get(String(n))!);
    return out;
  };
  const purpose = joinSubfields([...codes(20, 29), ...codes(60, 63)]);
  return {
    kind: cleanText(sub.get("00")),
    text: sepaPaymentText(purpose),
    name: joinSubfields(codes(32, 33)),
  };
}

export function readMt940(text: string): BankFile {
  const list = fields(text);
  if (!list.some((f) => f.tag === "61") && !list.some((f) => f.tag === "20")) {
    throw new BankFileError("mt940", "This file is not an MT940 statement.");
  }
  type Pending = Omit<BankTxn, "externalId"> & { idFields: string; statement: number };
  const transactions: Pending[] = [];
  let iban: string | undefined, accountNumber = "", currency = "EUR", skipped = 0;
  let statement = -1, intraday = false;
  const openings = new Map<number, string>(), closings = new Map<number, string>();
  const intradayStatements = new Set<number>();
  let last: Pending | null = null;

  for (const field of list) {
    if (field.tag === "20") { statement++; intraday = false; last = null; continue; }
    if (field.tag === "end") { last = null; continue; }
    if (field.tag === "25") {
      const value = field.value.trim();
      iban ??= findIban(value);
      accountNumber ||= value.split("/").pop()!.replace(/[^0-9]/g, "");
    } else if (field.tag === "34F" || field.tag === "13D" || field.tag === "13") {
      intraday = true;
      intradayStatements.add(statement);
    } else if (field.tag === "60F" || field.tag === "60M") {
      const bal = balanceOf(field.value);
      if (bal) { openings.set(statement, bal.amount); currency = bal.currency; }
    } else if (field.tag === "62F" || field.tag === "62M") {
      const bal = balanceOf(field.value);
      if (bal) closings.set(statement, bal.amount);
      last = null;
    } else if (field.tag === "61") {
      last = null;
      const [first] = field.value.split("\n");
      const m = LINE_61.exec(first.trim());
      const valueDate = m ? date6(m[1]) : null;
      const amount = m ? amountOf(m[5]) : null;
      if (!m || !valueDate || !amount || intraday) { skipped++; continue; }
      const debit = m[3] === "D" || m[3] === "RC"; // RC: a credit reversed
      last = {
        bookingDate: `${bookingDate(valueDate, m[2])}T00:00:00.000Z`,
        valueDate: `${valueDate}T00:00:00.000Z`,
        amount: debit ? negate(amount) : amount,
        currency,
        description: "(no description)",
        counterparty: null,
        raw: { ":61:": field.value, ":86:": "" },
        idFields: field.value.trim(),
        statement,
      };
      transactions.push(last);
    } else if (field.tag === "86" && last) {
      const d = details86(field.value);
      last.description = d.text || d.kind || d.name || "(no description)";
      last.counterparty = d.name || null;
      (last.raw as Record<string, string>)[":86:"] = field.value;
      last.idFields += `\u001f${field.value.replace(/\s+/g, " ").trim()}`;
      last = null;
    }
  }

  // Balance after each booking, from the opening balance, when the bookings run in date order and add up to the
  // closing balance (otherwise none is given rather than a wrong one).
  for (const [index, opening] of openings) {
    if (intradayStatements.has(index)) continue;
    const own = transactions.filter((t) => t.statement === index);
    if (!own.every((t, i) => i === 0 || own[i - 1].bookingDate <= t.bookingDate)) continue;
    let running = opening;
    const after = own.map((t) => (running = addAmounts(running, t.amount)));
    const closing = closings.get(index);
    if (own.length > 0 && (closing === undefined || sameAmount(running, closing))) own.forEach((t, i) => { t.balance = after[i]; });
  }

  const ids = bookingIds(transactions.map((t) => t.idFields));
  const account: BankAccount = { name: iban ? accountName("Bank", iban) : accountNumber ? `Bank ••${accountNumber.slice(-4)}` : "Bank", currency };
  if (iban) account.iban = iban;
  return {
    format: "mt940",
    account,
    transactions: transactions.map(({ idFields: _, statement: __, ...t }, i) => ({ externalId: ids[i], ...t })),
    skipped,
  };
}
