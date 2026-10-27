// Turns a layout someone shared from the app (the server's inbox; the app sends shareableLayout's answer) into a
// known bank: prints the entry for src/engine/readers/bank-profiles.ts and a test fixture with the export's header
// line and two made-up payments. Then review the entry (trim `match` to the defining columns if the header is long),
// add it at the end of BANK_PROFILES, save the fixture as src/engine/fixtures/banks/<id>.csv, run
// `npx tsx scripts/bank-fixtures.ts` and `npm test`.
//
//   npx tsx scripts/add-shared-layout.ts submission.json --name "Fiktivbank" --id fiktivbank
//
// The file holds the layout as JSON, or a record with it in `layout` (and the bank's name in `bank`, used when --name
// is not given). It came from outside, so it is checked with shareableLayout again and every string is written as a
// JSON literal: nothing in it can become code.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { splitCsv } from "../src/engine/readers/csv.js";
import { BANK_PROFILES, findProfile, profileLayout, type BankProfile } from "../src/engine/readers/profiles.js";
import { shareableLayout } from "../src/engine/readers/share.js";
import { findHeaderRow, readTable, uniqueHeader } from "../src/engine/readers/table.js";
import { headerKey, type DateFormat, type NumberFormat } from "../src/engine/readers/values.js";
import type { BankTxn, CsvLayout } from "../src/engine/readers/types.js";

type Column = string | number;

// The profile for a shared layout. Columns are named by their header cell, as the other profiles are; by number
// where the cell is blank or its name is not unique enough to find the column again (and in a file without a header).
export function profileFromLayout(layout: CsvLayout, bank: { id: string; name: string }, shared: string): BankProfile {
  const names = uniqueHeader(layout.header);
  const keys = names.map(headerKey);
  const column = (i: number): Column =>
    layout.header.length > 0 && i < layout.header.length && layout.header[i] !== "" && keys.indexOf(keys[i]) === i ? names[i] : i;
  const c = layout.columns;
  const columns: BankProfile["columns"] = { date: column(c.date) };
  for (const role of ["valueDate", "amount", "debit", "credit", "sign", "payer", "payee", "kind", "iban", "accountIban",
    "balance", "currency", "reference", "status"] as const) {
    const i = c[role];
    if (i !== undefined) columns[role] = column(i);
  }
  for (const role of ["counterparty", "text", "fees", "addAmounts"] as const) {
    const list = c[role];
    if (list?.length) columns[role] = list.map(column);
  }
  const headerless = layout.header.length === 0;
  return {
    id: bank.id,
    bank: bank.name,
    sources: [`Shared from the Aresium app (${shared})`],
    unconfirmed: "Shared by one person from their export: no public source, checked only with made-up payments.",
    separator: layout.separator,
    // Every header cell: the export is recognised only when its header is the same.
    match: headerless ? [] : [...new Set(layout.header.filter((h) => h !== ""))],
    ...(headerless ? { headerless: { columnCount: layout.columnCount!, ...(c.accountIban !== undefined ? { ibanColumn: c.accountIban } : {}) } } : {}),
    dateFormat: layout.dateFormat,
    numberFormat: layout.numberFormat,
    columns,
    ...(layout.labelledText ? { labelledText: layout.labelledText } : {}),
    ...(layout.skipStatus ? { skipStatus: layout.skipStatus } : {}),
    ...(layout.keepStatus ? { keepStatus: layout.keepStatus } : {}),
    ...(layout.invertSign ? { invertSign: true } : {}),
    ...(layout.currency ? { currency: layout.currency } : {}),
  };
}

// The profile as it is written in bank-profiles.ts. Strings are JSON literals, so nothing in them becomes code.
export function profileSource(profile: BankProfile): string {
  const value = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
    if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${value(x)}`).join(", ")} }`;
    return JSON.stringify(v);
  };
  const lines = Object.entries(profile).map(([key, v]) => {
    if (key === "sources") return `    sources: [\n${(v as string[]).map((s) => `      ${JSON.stringify(s)},`).join("\n")}\n    ],`;
    return `    ${key}: ${value(v)},`;
  });
  return `  {\n${lines.join("\n")}\n  },`;
}

// ── A test fixture: the header line and two made-up payments, one out and one in ──────────────────────────────

const MADE_UP = {
  out: { day: [2026, 2, 3], amount: -12.34, party: "Fiktiv Markt", text: "Einkauf Lebensmittel", kind: "Kartenzahlung", iban: "", balance: 987.66 },
  in: { day: [2026, 2, 5], amount: 1200, party: "Fiktiv Werke GmbH", text: "Gehalt Februar", kind: "Gutschrift", iban: "DE96100500000000123456", balance: 2187.66 },
} as const;
const ACCOUNT_IBAN = "DE53300209000000556677"; // made up, with valid check digits

function writeDate([y, m, d]: readonly number[], format: DateFormat): string {
  const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0"), yyyy = String(y);
  const written: Record<DateFormat, string> = {
    "DD.MM.YYYY": `${dd}.${mm}.${yyyy}`, "DD.MM.YY": `${dd}.${mm}.${yyyy.slice(2)}`, "YYYY-MM-DD": `${yyyy}-${mm}-${dd}`,
    "DD/MM/YYYY": `${dd}/${mm}/${yyyy}`, "MM/DD/YYYY": `${mm}/${dd}/${yyyy}`, "DD-MM-YYYY": `${dd}-${mm}-${yyyy}`,
    "YYYYMMDD": `${yyyy}${mm}${dd}`,
  };
  return written[format];
}

function writeAmount(n: number, format: NumberFormat): string {
  const [whole, cents] = Math.abs(n).toFixed(2).split(".");
  const [group, decimal] = format === "de" ? [".", ","] : [",", "."];
  return `${n < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)}${decimal}${cents}`;
}

const quoted = (cell: string, separator: string) => (/["\r\n]/.test(cell) || cell.includes(separator) ? `"${cell.replace(/"/g, '""')}"` : cell);

// The fixture's text: the header line (none for a file without one) and the two payments, written the way the layout
// reads them.
export function fixtureFor(layout: CsvLayout): string {
  const c = layout.columns;
  const used = Object.values(c).flat().filter((i): i is number => typeof i === "number");
  const width = Math.max(layout.header.length, layout.columnCount ?? 0, ...used.map((i) => i + 1));
  const row = (p: (typeof MADE_UP)["out" | "in"]): string[] => {
    const cells = new Array<string>(width).fill("");
    const set = (i: number | undefined, value: string) => { if (i !== undefined) cells[i] = value; };
    // Least important first: a column with two roles (comdirect's status is its booking day) keeps the later value.
    const status = layout.keepStatus?.[0] ?? "Gebucht";
    set(c.status, status);
    set(c.reference, p === MADE_UP.out ? "FICT-1" : "FICT-2");
    set(c.currency, layout.currency ?? "EUR");
    set(c.accountIban, ACCOUNT_IBAN);
    set(c.iban, p.iban);
    set(c.kind, p.kind);
    for (const i of [...(c.fees ?? []), ...(c.addAmounts ?? [])]) set(i, writeAmount(0, layout.numberFormat));
    set(c.balance, writeAmount(p.balance, layout.numberFormat));
    let text: string = p.text;
    if (layout.labelledText) {
      const { counterparty: [partyLabel], text: [textLabel] } = layout.labelledText;
      const textPart = textLabel === undefined ? "" : textLabel === "" ? p.text : `${textLabel}: ${p.text}`;
      const partyPart = partyLabel === undefined ? "" : `${partyLabel}: ${p.party}`;
      text = textLabel === "" ? [textPart, partyPart].filter(Boolean).join(" ") : [partyPart, textPart].filter(Boolean).join(" ");
    }
    set(c.text?.[0], text);
    set(c.counterparty?.[0], p.party);
    set(p.amount < 0 ? c.payee : c.payer, p.party);
    const shown = layout.invertSign ? -p.amount : p.amount;
    if (c.amount !== undefined) {
      set(c.amount, writeAmount(c.sign !== undefined ? Math.abs(shown) : shown, layout.numberFormat));
      set(c.sign, shown < 0 ? "S" : "H");
    } else set(shown < 0 ? c.debit : c.credit, writeAmount(Math.abs(shown), layout.numberFormat));
    set(c.valueDate, writeDate(p.day, layout.dateFormat));
    set(c.date, writeDate(p.day, layout.dateFormat));
    return cells;
  };
  const lines = [...(layout.header.length > 0 ? [layout.header] : []), row(MADE_UP.out), row(MADE_UP.in)];
  return lines.map((cells) => cells.map((cell) => quoted(cell, layout.separator)).join(layout.separator)).join("\n") + "\n";
}

// The fixture read with the new profile, as the app would: the layout the profile makes of it (to compare with the
// shared one), its payments, and an existing profile that would read the file first, if any.
export function checkProfile(profile: BankProfile, fixture: string): { layout: CsvLayout | null; payments: BankTxn[]; takenBy?: string } {
  const separator = Array.isArray(profile.separator) ? profile.separator[0] : profile.separator;
  const rows = splitCsv(fixture, separator);
  const headerRow = profile.headerless ? -1 : findHeaderRow(rows, profile.match.map((m) => [m].flat().map(headerKey)));
  const layout = profile.headerless || headerRow >= 0 ? profileLayout(profile, rows, headerRow, separator) : null;
  const payments = layout ? readTable(rows, headerRow, layout).transactions : [];
  const existing = findProfile(rows, separator);
  return { layout, payments, ...(existing ? { takenBy: existing.profile.id } : {}) };
}

// The shared layout, compared without the fields the profile adds (its name and id).
export function sameLayout(shared: CsvLayout, fromProfile: CsvLayout): boolean {
  const { name: _name, profile: _profile, ...rest } = fromProfile;
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v);
  return JSON.stringify(sorted(rest)) === JSON.stringify(sorted(shared));
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string" }, id: { type: "string" } } });
  if (positionals.length !== 1) throw new Error('Usage: npx tsx scripts/add-shared-layout.ts <file.json> --name "Bank name" --id some-id');
  const record = JSON.parse(await readFile(positionals[0], "utf8")) as Record<string, unknown>;
  const submitted = (record && typeof record === "object" && "layout" in record ? record.layout : record) as CsvLayout;
  const name = values.name ?? (typeof record.bank === "string" ? record.bank : undefined);
  if (!name?.trim()) throw new Error("No bank name: pass --name");
  const id = values.id ?? name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`The id "${id}" must be lower-case words joined by "-"`);
  if (BANK_PROFILES.some((p) => p.id === id)) throw new Error(`A profile with the id "${id}" exists already`);

  const shared = shareableLayout(submitted);
  if (!shared.ok) throw new Error(`The layout cannot be used: ${shared.reason}`);
  const profile = profileFromLayout(shared.layout, { id, name: name.trim() }, new Date().toISOString().slice(0, 10));
  const fixture = fixtureFor(shared.layout);
  const check = checkProfile(profile, fixture);

  console.log("// ── src/engine/readers/bank-profiles.ts: add at the end of BANK_PROFILES ──");
  console.log(profileSource(profile));
  console.log(`\n// ── src/engine/fixtures/banks/${id}.csv (made-up payments) ──`);
  process.stdout.write(fixture);
  console.log("\n// ── Check ──");
  console.log(check.layout && sameLayout(shared.layout, check.layout)
    ? "The profile reads the fixture with the same layout that was shared."
    : "WARNING: the profile does not read the fixture with the shared layout; compare columns and formats by hand.");
  console.log(`Payments read: ${check.payments.map((t) => t.amount).join(", ") || "none"} (want -12.34, 1200.00)`);
  if (check.takenBy) console.log(`WARNING: the existing profile "${check.takenBy}" already reads this header; is it the same bank?`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
