import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, learn, ownTransfers, OWN_TRANSFERS, sortPayments, type TransferPayment } from "./index.js";
import { isPaypalBankLine } from "./sorting/transfers.js";

// Made-up payments as the readers produce them: VR Bank lines, PayPal export rows. Fictional shops and amounts; the
// accounts are plain keys.
const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
const bank = (date: string, amount: number, counterparty: string | null, description = "", account = "giro"): TransferPayment =>
  ({ source: "bank", account, date, amount, currency: "EUR", counterparty, description });
const paypal = (date: string, amount: number, counterparty: string, description = counterparty): TransferPayment =>
  ({ source: "paypal", account: "paypal", date, amount, currency: "EUR", counterparty, description });
const sources = (payments: TransferPayment[], learned = {}) =>
  sortPayments(payments, { categories: all, learned }).map((r) => r.source === "structural" ? OWN_TRANSFERS : r.categoryId);

// ---- 1. PayPal's bank lines -----------------------------------------------------------------------------------

const bankPaypalLine = bank("2026-02-04", -18.9, "PayPal Europe S.a.r.l. et Cie S.C.A", "PP.4711.PP . Ihr Einkauf bei Märchenladen");
const paypalPurchase = paypal("2026-02-03", -18.9, "Märchenladen");

test("with PayPal export rows, the bank's PayPal line is an own transfer, before learned rules", () => {
  // The measured error: learning "Märchenladen → Clothes" from the PayPal row also sorted the bank line as Clothes.
  const learned = learn({}, paypalPurchase, "clothes");
  const results = sortPayments([bankPaypalLine, paypalPurchase], { categories: all, learned });
  assert.deepEqual(results, [{ categoryId: OWN_TRANSFERS, source: "structural" }, { categoryId: "clothes", source: "learned" }]);
  assert.deepEqual(ownTransfers([bankPaypalLine, paypalPurchase]), [{ rule: "paypal" }, null]);
});

test("without PayPal export rows nothing changes: the bank line is the only record of the purchase", () => {
  const learned = learn({}, paypalPurchase, "clothes");
  assert.deepEqual(sortPayments([bankPaypalLine], { categories: all, learned }), [{ categoryId: "clothes", source: "learned" }]);
  assert.deepEqual(sortPayments([bankPaypalLine], { categories: all }), [{ categoryId: null, source: null }]);
  assert.deepEqual(ownTransfers([bankPaypalLine, bank("2026-02-05", -3, "REWE Markt")]), [null, null]);
});

test("banks' ways of naming PayPal are recognised, in the counterparty or the text, either sign", () => {
  for (const line of [
    bank("2026-02-04", -10, "PayPal Europe S.a.r.l. et Cie S.C.A"),
    bank("2026-02-04", -10, "PayPal (Europe) S.a.r.l. et Cie, S.C.A.", "1234567890123 PP.4711.PP . Ihr Einkauf bei Bücherinsel"),
    bank("2026-02-04", -10, "PAYPAL *FOTOHAUS", "Kartenzahlung"),
    bank("2026-02-04", -10, "PayPal"),
    bank("2026-02-04", -10, null, "PayPal Europe S.a.r.l. et Cie S.C.A. PP.4711.PP . Ihr Einkauf bei Bücherinsel"),
    bank("2026-02-04", -10, "", "Lastschrift PAYPAL *STREAMINGDIENST 4029357733"),
    bank("2026-02-04", -10, "Kartenzahlung", "paypal (europe) s.a r.l. et cie"),
    bank("2026-02-06", 25, "PayPal Europe S.a.r.l. et Cie S.C.A", "Auszahlung von PayPal"),
    { source: undefined, counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A" },
  ]) assert.equal(isPaypalBankLine(line), true, `${line.counterparty} / ${line.description}`);
});

test("shops and people that only mention PayPal, and PayPal's own rows, are not PayPal's bank lines", () => {
  for (const line of [
    bank("2026-02-04", -10, "Paypalooza GmbH"),
    bank("2026-02-04", 15, "Max Mustermann", "Geld zurück, PayPal ging nicht"),
    bank("2026-02-04", -10, "Fiktivbüro", "Rechnung 42, zahlbar per PayPal oder Überweisung"),
    paypal("2026-02-04", -10, "PayPal Europe S.a.r.l. et Cie S.C.A"),
    bank("2026-02-04", -10, null, ""),
  ]) assert.equal(isPaypalBankLine(line), false, `${line.counterparty} / ${line.description}`);
  assert.deepEqual(sources([bank("2026-02-04", -10, "Paypalooza GmbH"), paypalPurchase]), [null, null]);
});

// ---- 2. Between accounts --------------------------------------------------------------------------------------

test("money moved to one's own other account is an own transfer on both sides", () => {
  const payments = [
    bank("2026-03-01", -500, "Eigenes Tagesgeld", "Umbuchung", "giro"),
    bank("2026-03-02", 500, "Girokonto", "Gutschrift", "tagesgeld"),
    bank("2026-03-02", -42.5, "REWE Markt GmbH", "", "giro"),
  ];
  assert.deepEqual(ownTransfers(payments), [{ rule: "accounts", pairedWith: 1 }, { rule: "accounts", pairedWith: 0 }, null]);
  assert.deepEqual(sources(payments), [OWN_TRANSFERS, OWN_TRANSFERS, "groceries"]);
});

test("two equal transfers on the same day make two pairs; each payment pairs at most once", () => {
  const payments = [
    bank("2026-03-05", -250, "Kreditkarte", "Ausgleich", "giro"),
    bank("2026-03-05", -250, "Kreditkarte", "Ausgleich", "giro"),
    bank("2026-03-05", 250, "Girokonto", "Einzahlung", "karte"),
    bank("2026-03-05", 250, "Girokonto", "Einzahlung", "karte"),
    bank("2026-03-05", 250, "Girokonto", "Einzahlung", "tagesgeld"), // a third with no partner left
  ];
  assert.deepEqual(ownTransfers(payments), [
    { rule: "accounts", pairedWith: 2 }, { rule: "accounts", pairedWith: 3 },
    { rule: "accounts", pairedWith: 0 }, { rule: "accounts", pairedWith: 1 }, null,
  ]);
});

test("the closest dates pair first; exactly three days apart still pairs", () => {
  const payments = [
    bank("2026-03-10", -100, null, "Übertrag", "giro"),
    bank("2026-03-13", 100, null, "Übertrag", "tagesgeld"), // three days after
    bank("2026-03-11", 100, null, "Übertrag", "tagesgeld"), // one day after: wins
    bank("2026-03-16", -100, null, "Übertrag", "giro"), // three days after the 13th: pairs with it
  ];
  assert.deepEqual(ownTransfers(payments), [
    { rule: "accounts", pairedWith: 2 }, { rule: "accounts", pairedWith: 3 },
    { rule: "accounts", pairedWith: 0 }, { rule: "accounts", pairedWith: 1 },
  ]);
  // Across a month's end, with the server's timestamps and plain dates mixed.
  assert.deepEqual(ownTransfers([
    { ...bank("2026-02-27T00:00:00.000Z", -60, null, "", "giro") }, bank("2026-03-02", 60, null, "", "tagesgeld"),
  ]).map((r) => r?.rule ?? null), ["accounts", "accounts"]);
});

test("near-matches do not pair: four days, one cent, one account, the same sign, another currency, no account", () => {
  const out = bank("2026-03-10", -80, "Fiktivbüro", "Rechnung", "giro");
  for (const partner of [
    bank("2026-03-14", 80, "Erstattung", "", "tagesgeld"), // four days later
    bank("2026-03-06", 80, "Erstattung", "", "tagesgeld"), // four days earlier
    bank("2026-03-10", 80.01, "Erstattung", "", "tagesgeld"), // one cent more
    bank("2026-03-10", 80, "Fiktivbüro", "Gutschrift", "giro"), // money back on the same account
    bank("2026-03-10", -80, "Fiktivbüro", "", "tagesgeld"), // the same sign
    { ...bank("2026-03-10", 80, "Erstattung", "", "karte"), currency: "USD" }, // another currency
    { ...bank("2026-03-10", 80, "Erstattung", ""), account: null }, // no account known
  ]) assert.deepEqual(ownTransfers([out, partner]), [null, null], JSON.stringify(partner));
  // Payments without amount or date never pair, and amounts of zero have no direction.
  assert.deepEqual(ownTransfers([{ account: "giro", amount: -5 }, { account: "karte", amount: 5 }]), [null, null]);
  assert.deepEqual(ownTransfers([bank("2026-03-10", 0, "", "", "giro"), bank("2026-03-10", -0, "", "", "karte")]), [null, null]);
});

test("one account only: nothing pairs", () => {
  assert.deepEqual(ownTransfers([bank("2026-03-10", -20, "Max Mustermann", "Pizza"), bank("2026-03-11", 20, "Max Mustermann", "Pizza zurück")]), [null, null]);
});

test("a bank's PayPal line pairs with PayPal's funding row, so the funding row cannot pair with anything else", () => {
  const payments = [
    bank("2026-03-03", -18.9, "PayPal Europe S.a.r.l. et Cie S.C.A", "PP.4711.PP . Ihr Einkauf bei Märchenladen"),
    paypal("2026-03-03", -18.9, "Märchenladen"),
    paypal("2026-03-03", 18.9, "Märchenladen", "Bankgutschrift auf PayPal-Konto"),
    bank("2026-03-04", -18.9, "Fiktivbüro", "Rechnung 17", "karte"),
  ];
  assert.deepEqual(ownTransfers(payments), [{ rule: "accounts", pairedWith: 2 }, null, { rule: "accounts", pairedWith: 0 }, null]);
  assert.deepEqual(sources(payments), [OWN_TRANSFERS, null, OWN_TRANSFERS, null]);
});

test("structural results use the built-in category even when the person's list is empty", () => {
  const payments = [bank("2026-03-01", -500, null, "Umbuchung", "giro"), bank("2026-03-01", 500, null, "Umbuchung", "tagesgeld")];
  assert.deepEqual(sortPayments(payments, { categories: [] }), [
    { categoryId: OWN_TRANSFERS, source: "structural" }, { categoryId: OWN_TRANSFERS, source: "structural" },
  ]);
});
