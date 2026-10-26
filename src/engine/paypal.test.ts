import test from "node:test";
import assert from "node:assert/strict";
import { foldPaypalConversions, isPaypalBankFunding } from "./paypal.js";

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
