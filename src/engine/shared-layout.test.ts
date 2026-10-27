import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { checkProfile, fixtureFor, profileFromLayout, profileSource, sameLayout } from "../../scripts/add-shared-layout.js";
import { bankFixtures } from "../../scripts/bank-fixtures.js";
import { bundleEngine } from "../../scripts/build-engine.js";
import { decodeBankFile } from "./readers/decode.js";
import { readCsv } from "./readers/table.js";
import { BANK_PROFILES } from "./readers/bank-profiles.js";
import { looksPersonal, MAX_BYTES, MAX_CELL } from "./readers/share.js";
import * as engine from "./index.js";

const context = createContext({});
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

// Every known bank's layout, as the readers make it from that bank's fixture (made-up payments, real headers).
const known: { name: string; text: string; layout: engine.CsvLayout }[] = [];
for (const name of await bankFixtures()) {
  const text = decodeBankFile(new Uint8Array(await readFile(new URL(`fixtures/banks/${name}`, import.meta.url))));
  const detected = engine.detectBankFile(text);
  if (detected.format === "csv" && detected.layout) known.push({ name, text, layout: detected.layout });
}
const guessed = (text: string) => engine.guessCsvLayout(text).layout!;
const fiktivbank = guessed(decodeBankFile(new Uint8Array(await readFile(new URL("fixtures/banks/unknown-fiktivbank.csv", import.meta.url)))));

// The inbox's checks on the server, as brief 21 describes them: JSON under 8 KB with version 1 and no name or profile,
// a separator, at most 80 header strings, text of at most 80 characters, columns as numbers 0–80 or lists of them,
// nothing nested deeper than columns.text, and no string that looks like an IBAN, an email address, a date (also
// "3-Jan-2026"), an amount (also "12 EUR", "€ 5") or a long number (five digits, or grouped ones of eight or more).
// Written independently of share.ts, on purpose.
function inboxAccepts(layout: unknown): boolean {
  const text = JSON.stringify(layout);
  if (Buffer.byteLength(text) >= 8192) return false;
  const l = JSON.parse(text) as Record<string, unknown>;
  if (l.version !== 1 || typeof l.separator !== "string" || "name" in l || "profile" in l) return false;
  if (!Array.isArray(l.header) || l.header.length > 80) return false;
  const column = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 80;
  if (!Object.values(l.columns as object).every((v) => column(v) || (Array.isArray(v) && v.every(column)))) return false;
  const strings: string[] = [];
  const collect = (v: unknown, depth: number): boolean => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") return depth < 3 && Object.values(v).every((x) => collect(x, depth + 1));
    return true;
  };
  if (!collect(l, 0)) return false;
  const personal = [/[A-Z]{2}\d{2}[A-Z0-9]{11,}/i, /\S+@\S+/, /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/, /\d{4}-\d{2}-\d{2}/,
    /\d{1,2}-[a-z]{3}-\d{2,4}/i, /\d+[.,]\d{2}\b/, /\d\s*(EUR|USD|€|\$)/, /(EUR|USD|€|\$)\s*\d/, /\d{5,}/];
  const grouped = (s: string) => (s.match(/\d[\d\s/-]*\d/g) ?? []).some((run) => run.replace(/\D/g, "").length >= 8);
  return strings.every((s) => s.length <= 80 && !grouped(s) && !personal.some((p) => p.test(s.replace(/\s/g, "")) || p.test(s)));
}

test("every known bank's layout can be shared, the copy has no name and reads the file the same", () => {
  const covered = new Set(known.map((k) => k.layout.profile));
  assert.deepEqual([...covered].sort(), engine.BANK_PROFILES.map((p) => p.id).sort(), "a fixture for every profile");
  for (const { name, text, layout } of known) {
    const shared = engine.shareableLayout(layout);
    assert.ok(shared.ok, `${name}: ${!shared.ok && shared.reason}`);
    assert.equal(shared.layout.version, 1);
    assert.ok(!("name" in shared.layout) && !("profile" in shared.layout), name);
    assert.ok(inboxAccepts(shared.layout), `${name}: the inbox would refuse it`);
    assert.deepEqual(json(shared.layout), shared.layout, `${name}: plain JSON`);
    assert.deepEqual(readCsv(text, shared.layout).transactions, readCsv(text, layout).transactions, name);
  }
});

test("a layout whose header or status words look personal is refused, not sent with less", () => {
  const withHeader = (i: number, cell: string) => {
    const header = [...fiktivbank.header];
    header[i] = cell;
    return { ...fiktivbank, header };
  };
  const cases: [string, string][] = [
    ["Konto DE89 3704 0044 0532 0130 00", "iban"],
    ["Umsätze 01.02.2026", "date"],
    ["Stand 2026-02-07", "date"],
    ["Saldo am 7. Februar", "date"],
    ["Umsätze Feb 2026", "date"],
    ["Kontostand 1.152,03", "amount"],
    ["Konto 0532013000", "digits"],
    ["Kunde 12 345 678", "digits"],
    ["max.mustermann@example.de", "email"],
    ["x".repeat(MAX_CELL + 1), "tooLong"],
    // Whole amounts with a currency, card and account numbers in groups, dates with a month's name and hyphens.
    ["Saldo 12 EUR", "amount"],
    ["Limit € 5", "amount"],
    ["Gebühr 5€", "amount"],
    ["EUR 1200 Rahmen", "amount"],
    ["Karte 4111-1111-1111-1111", "digits"],
    ["Konto 1234/5678", "digits"],
    ["Stand 3-Jan-2026", "date"],
  ];
  for (const [cell, reason] of cases) assert.deepEqual(engine.shareableLayout(withHeader(2, cell)), { ok: false, reason }, cell);
  assert.deepEqual(engine.shareableLayout({ ...fiktivbank, skipStatus: ["vorgemerkt", "storno 07.02.2026"] }), { ok: false, reason: "date" });
  assert.deepEqual(engine.shareableLayout({ ...fiktivbank, labelledText: { labels: ["IBAN DE89370400440532013000"], counterparty: [], text: [""] } }),
    { ok: false, reason: "iban" });
  // Ordinary column names pass, numbered ones and words that only start like a month too.
  for (const cell of ["Betrag (€)", "Umsatz in EUR", "Betrag (EUR)", "Name (2)", "Top 10 Marken", "Kto/IBAN", "Saldo nach Buchung",
    "Umsätze 2026", "Seite 1/2"]) {
    assert.equal(engine.shareableLayout(withHeader(2, cell)).ok, true, cell);
  }
});

test("the copy keeps only what the readers use, and refuses what they could not use", () => {
  const extra = { ...fiktivbank, name: "Meine Bank", profile: "x", raw: { secret: "Fiktiv" },
    columns: { ...fiktivbank.columns, note: 9 } } as unknown as engine.CsvLayout;
  const shared = engine.shareableLayout(extra);
  assert.ok(shared.ok);
  assert.deepEqual(shared.layout, { ...fiktivbank, columns: fiktivbank.columns });
  const invalid: unknown[] = [
    null, "layout", { ...fiktivbank, version: 2 }, { ...fiktivbank, separator: "x" }, { ...fiktivbank, dateFormat: "DD.MM" },
    { ...fiktivbank, numberFormat: "fr" }, { ...fiktivbank, header: [1, 2] }, { ...fiktivbank, columns: { amount: 1 } },
    { ...fiktivbank, columns: { date: 0 } }, { ...fiktivbank, columns: { ...fiktivbank.columns, text: [1.5] } },
    { ...fiktivbank, columns: { ...fiktivbank.columns, balance: -1 } }, { ...fiktivbank, currency: "euro" },
    { ...fiktivbank, header: [], columnCount: undefined }, { ...fiktivbank, skipStatus: "vorgemerkt" },
  ];
  for (const layout of invalid) {
    assert.deepEqual(engine.shareableLayout(layout as engine.CsvLayout), { ok: false, reason: "invalid" }, JSON.stringify(layout));
  }
  const wide = { ...fiktivbank, header: Array.from({ length: 81 }, (_, i) => `Spalte ${i + 1}`) };
  assert.deepEqual(engine.shareableLayout(wide), { ok: false, reason: "tooWide" });
  assert.deepEqual(json(bundled.shareableLayout(fiktivbank)), json(engine.shareableLayout(fiktivbank)));
});

test("every string a known bank's layout can hold passes, as it passes the inbox", () => {
  const strings: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  // Not their sources, notes and names: those never travel in a layout.
  for (const { sources: _s, unconfirmed: _u, variant: _v, bank: _b, id: _i, ...layoutPart } of BANK_PROFILES) collect(layoutPart);
  assert.ok(strings.length > 500);
  assert.deepEqual(strings.filter((s) => looksPersonal(s) !== null), []);
});

test("the bank's name never travels, a layout over 8 KB is refused, and column numbers stop at 79", () => {
  const named = engine.shareableLayout({ ...fiktivbank, name: "Fiktivbank Musterstadt", profile: "fiktivbank" });
  assert.ok(named.ok && !("name" in named.layout) && !("profile" in named.layout));
  assert.ok(named.ok && !JSON.stringify(named.layout).includes("Musterstadt"));

  const words = (prefix: string) => Array.from({ length: 80 }, (_, i) => `${prefix}${"x".repeat(45)}${String.fromCharCode(97 + (i % 26))}`);
  const large = { ...fiktivbank, header: words("Spalte"), skipStatus: words("vorgemerkt") };
  assert.ok(JSON.stringify(large).length > MAX_BYTES);
  assert.deepEqual(engine.shareableLayout(large), { ok: false, reason: "tooLarge" });
  assert.equal(engine.shareableLayout({ ...large, skipStatus: undefined }).ok, true, "80 header cells alone fit");

  assert.equal(engine.shareableLayout({ ...fiktivbank, columns: { ...fiktivbank.columns, balance: 79 } }).ok, true);
  assert.deepEqual(engine.shareableLayout({ ...fiktivbank, columns: { ...fiktivbank.columns, balance: 80 } }), { ok: false, reason: "invalid" });
  const headerless = { ...fiktivbank, header: [], columnCount: 80 };
  assert.equal(engine.shareableLayout(headerless).ok, true);
  assert.deepEqual(engine.shareableLayout({ ...headerless, columnCount: 81 }), { ok: false, reason: "tooWide" });
});

test("add-shared-layout: a shared layout becomes a profile that reads its fixture with that same layout", () => {
  const headerless = guessed(["03.02.2026;Fiktiv Markt Einkauf;-23,17;'DE53300209000000556677'",
    "04.02.2026;Fiktiv Werke Gehalt;1.800,00;'DE53300209000000556677'"].join("\n"));
  const layouts = [...known.map((k) => k.layout), fiktivbank, headerless, { ...fiktivbank, invertSign: true }];
  for (const layout of layouts) {
    const shared = engine.shareableLayout(layout);
    assert.ok(shared.ok);
    const profile = profileFromLayout(shared.layout, { id: "fiktivbank", name: "Fiktivbank" }, "2026-10-27");
    const check = checkProfile(profile, fixtureFor(shared.layout));
    const label = layout.profile ?? JSON.stringify(layout.header);
    assert.ok(check.layout && sameLayout(shared.layout, check.layout), `${label}: reads the shared layout back`);
    assert.deepEqual(check.payments.map((t) => t.amount), ["-12.34", "1200.00"], label);
  }
  // A bank nobody knows yet is read by no existing profile; one of the known ones is, and the script says so.
  const fresh = engine.shareableLayout(fiktivbank);
  assert.ok(fresh.ok);
  assert.equal(checkProfile(profileFromLayout(fresh.layout, { id: "f", name: "F" }, "2026-10-27"), fixtureFor(fresh.layout)).takenBy, undefined);
  const ing = known.find((k) => k.layout.profile === "ing")!.layout;
  const shared = engine.shareableLayout(ing);
  assert.ok(shared.ok);
  assert.equal(checkProfile(profileFromLayout(shared.layout, { id: "i", name: "I" }, "2026-10-27"), fixtureFor(shared.layout)).takenBy, "ing");
});

test("add-shared-layout prints the profile as plain data, whatever the shared header holds", () => {
  const header = [...fiktivbank.header];
  header[2] = 'Gegen"seite`${globalThis.hacked = 1}`*/ \\';
  const shared = engine.shareableLayout({ ...fiktivbank, header });
  assert.ok(shared.ok);
  const profile = profileFromLayout(shared.layout, { id: "fiktivbank", name: "Fiktiv \"Bank\"" }, "2026-10-27");
  const source = profileSource(profile);
  const sandbox = createContext({});
  const parsed = runInContext(`(${source.trim().replace(/,$/, "")})`, sandbox);
  assert.equal(runInContext("typeof hacked", sandbox), "undefined");
  assert.deepEqual(json(parsed), json(profile));
  assert.equal(profile.columns.counterparty?.[0], header[2]);
  assert.deepEqual(profile.match, header);
});
