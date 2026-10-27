import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { foldPaypalConversions, isPaypalBankFunding } from "./paypal.js";
import { readBankText } from "./readers/read.js";
import type { BankTxn } from "./readers/types.js";
import { buildDashboardSource, type SourcePayment } from "./source.js";

type R = { externalId: string | null; currency: string; amount: number; raw: Record<string, string>; place?: string; category?: string };
const purchase = (id: string, ccy: string, amount: number, extra: Partial<R> = {}): R =>
  ({ externalId: id, currency: ccy, amount, raw: { Typ: "PayPal Express-Zahlung" }, place: "Shop", category: "Development", ...extra });
const conversion = (id: string, related: string, ccy: string, amount: number, keys = { type: "Typ", related: "Zugehöriger Transaktionscode" }): R =>
  ({ externalId: id, currency: ccy, amount, raw: { [keys.type]: keys.type === "Typ" ? "Allgemeine Währungsumrechnung" : "General Currency Conversion", [keys.related]: related } });

test("a dollar purchase is counted at its euro cost and both conversion rows drop out", () => {
  const rows = [purchase("X", "USD", -105.91), conversion("C1", "X", "USD", 105.91), conversion("C2", "X", "EUR", -95.07)];
  const { rows: out, unmatched } = foldPaypalConversions(rows);
  assert.deepEqual(out.map((r) => [r.externalId, r.currency, r.amount, r.category]), [["X", "EUR", -95.07, "Development"]]);
  assert.deepEqual(unmatched, []);
});

test("without a euro conversion row the purchase stays as it is and is reported", () => {
  const rows = [purchase("Y", "USD", -10), conversion("C3", "Y", "USD", 10)];
  const { rows: out, unmatched } = foldPaypalConversions(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.currency), ["USD", "USD"]);
  assert.deepEqual(unmatched, ["Y"]);
});

test("euro purchases and unrelated rows are untouched, order is kept", () => {
  const rows = [purchase("E1", "EUR", -5), purchase("X", "USD", -8.32), conversion("C1", "X", "USD", 8.32),
    conversion("C2", "X", "EUR", -7.62), purchase("E2", "EUR", -3)];
  const { rows: out } = foldPaypalConversions(rows);
  assert.deepEqual(out.map((r) => [r.externalId, r.amount]), [["E1", -5], ["X", -7.62], ["E2", -3]]);
});

test("English PayPal exports (Type / Reference Txn ID) work the same", () => {
  const en = { type: "Type", related: "Reference Txn ID" };
  const rows = [purchase("X", "USD", -11.48, { raw: { Type: "Express Checkout Payment" } }),
    conversion("C1", "X", "USD", 11.48, en), conversion("C2", "X", "EUR", -10.4, en)];
  assert.deepEqual(foldPaypalConversions(rows).rows.map((r) => [r.currency, r.amount]), [["EUR", -10.4]]);
});

test("a foreign-currency refund takes its positive euro leg", () => {
  const rows = [purchase("R", "USD", 20, { raw: { Typ: "Rückzahlung" } }), conversion("C1", "R", "USD", -20), conversion("C2", "R", "EUR", 18.1)];
  assert.deepEqual(foldPaypalConversions(rows).rows.map((r) => [r.currency, r.amount]), [["EUR", 18.1]]);
});

test("bank funding rows are found by their text or their original row; purchases and bank lines are not", () => {
  assert.equal(isPaypalBankFunding({ description: "Bankgutschrift auf PayPal-Konto" }), true);
  assert.equal(isPaypalBankFunding({ description: "Märchenladen", raw: { Typ: "Bankgutschrift auf PayPal-Konto" } }), true);
  assert.equal(isPaypalBankFunding({ description: "BANKGUTSCHRIFT AUF PAYPAL-KONTO" }), true);
  for (const t of [
    { description: "Märchenladen", raw: { Typ: "Allgemeine Zahlung" } },
    { description: "PayPal Europe S.a.r.l. et Cie S.C.A", raw: null },
    { description: "Fiktivbüro" },
  ]) assert.equal(isPaypalBankFunding(t), false, t.description);
});

test("English exports' funding rows are left out too: bank and card deposits, by their type or description", () => {
  for (const t of [
    { description: "Bank Deposit to PP Account " }, // PayPal's activity download pads it with a space
    { description: "Fiktiv Online Shop", raw: { Type: "General Card Deposit" } }, // PayPal filled in the shop
    { description: "PayPal", raw: { Description: "General Credit Card Deposit" } }, // the statement-style export
    { description: "general  card deposit" },
    { description: "Fiktiv Online Shop", raw: { Type: "Bank deposit to PayPal account" } }, // PayPal's event code names
    { description: "Fiktiv Online Shop", raw: { Type: "Electronic funds transfer funding" } },
    { description: "Fiktiv Online Shop", raw: { Type: "Credit card deposit for negative PayPal account balance" } },
  ]) assert.equal(isPaypalBankFunding(t), true, JSON.stringify(t));
  for (const t of [
    { description: "Fiktiv Online Shop", raw: { Type: "Express Checkout Payment" } },
    { description: "Fiktiv Online Shop", raw: { Type: "General Withdrawal - Bank Account" } }, // money out to the bank
    { description: "Fiktiv Online Shop", raw: { Type: "Payment Refund" } },
    { description: "Thanks for the general card deposit tip", raw: { Subject: "About the bank deposit to PP account" } },
  ]) assert.equal(isPaypalBankFunding(t), false, JSON.stringify(t));
});

// The readers' PayPal rows as the dashboard's input (no categories: only which rows count matters here).
const fixtureText = (name: string) => readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const asPayments = (rows: BankTxn[]): SourcePayment[] => rows.map((t) => ({
  id: t.externalId, externalId: t.externalId, date: t.bookingDate, amount: Number(t.amount), currency: t.currency,
  description: t.description, counterparty: t.counterparty, raw: t.raw, category: null,
}));
const counted = (rows: BankTxn[]) =>
  buildDashboardSource({ transactions: asPayments(rows), categories: [], today: "2026-02-28" }).transactions.map((t) => [t.id, t.amount]);

test("German PayPal exports count exactly as before the English names were added", async () => {
  // The rule before 2026-10-27, kept as the reference: only "Bankgutschrift auf PayPal" was funding.
  const before = (t: { description: string; raw?: unknown }) =>
    (t.description + " " + JSON.stringify(t.raw ?? "")).toLowerCase().includes("bankgutschrift auf paypal");
  const activity = readBankText(await fixtureText("paypal.csv")).transactions;
  // The statement-style export, with a funding row added in its own wording.
  const statement = readBankText((await fixtureText("banks/paypal-statement-de.csv")).trimEnd() + "\n" +
    '"05.02.2026","11:00:00","Europe/Berlin","Bankgutschrift auf PayPal-Konto","EUR","18,90","0,00","18,90","0,00","FICTIONAL-DE-3","","Fiktiv Onlineshop","Fiktive Volksbank eG","0011","0,00","0,00","",""\n').transactions;
  for (const rows of [activity, statement]) {
    assert.deepEqual(rows.map((t) => isPaypalBankFunding(t)), rows.map(before));
    assert.ok(rows.some(before), "the fixture has a funding row");
  }
  assert.deepEqual(counted(activity), [["FICTIONAL-PAY-1", -18.9], ["FICTIONAL-REFUND", 3.5]]);
  assert.deepEqual(counted(statement), [["FICTIONAL-DE-1", -18.9], ["FICTIONAL-DE-2", 3.5]]);
  // The English export's funding row, which used to count as money in, is now left out as well.
  const english = readBankText(await fixtureText("banks/paypal-activity-en.csv")).transactions;
  assert.deepEqual(english.map(before), [false, false]);
  assert.deepEqual(counted(english), [["FICTIONAL-EN-1", -18.9]]);
});
