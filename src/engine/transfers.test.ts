import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, buildDashboard, learn, ownTransfers, OWN_TRANSFERS, sortPayments, type TransferPayment } from "./index.js";
import { isPaypalBankLine, isPaypalFundingRow, saysOwnTransfer } from "./sorting/transfers.js";
import { buildDashboardSource } from "./source.js";

// Made-up payments as the readers produce them: VR Bank lines, PayPal export rows. Fictional shops and amounts; the
// accounts are plain keys, the IBANs textbook examples.
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

// ---- PayPal's currency conversions (brief 34) -----------------------------------------------------------------

const conversionRows = (english = false, refund = false) => {
  const purchase = {
    source: "paypal" as const, account: "paypal", date: "2026-10-08", externalId: "PURCHASE", currency: "USD",
    amount: refund ? 28.5 : -28.5, counterparty: "Beispielshop", description: "Beispielshop",
    raw: english ? { Type: "Express Checkout Payment" } : { Typ: "PayPal Express-Zahlung" },
  };
  const raw = english
    ? { Type: "General Currency Conversion", "Reference Txn ID": "PURCHASE" }
    : { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": "PURCHASE" };
  return [purchase,
    { ...purchase, externalId: "CONVERSION-USD", counterparty: "", description: "", amount: -purchase.amount, raw },
    { ...purchase, externalId: "CONVERSION-EUR", counterparty: "", description: "", currency: "EUR", amount: refund ? 25.7 : -25.7, raw },
  ];
};

test("both PayPal conversion rows are own transfers only when their foreign purchase and euro leg are present", () => {
  for (const english of [false, true]) for (const refund of [false, true]) {
    const rows = conversionRows(english, refund);
    assert.deepEqual(ownTransfers(rows), [null, { rule: "paypal-conversion" }, { rule: "paypal-conversion" }]);
    assert.deepEqual(sortPayments(rows, { categories: [] }), [
      { categoryId: null, source: null },
      { categoryId: "own-transfers", source: "structural" },
      { categoryId: "own-transfers", source: "structural" },
    ]);
    assert.deepEqual(ownTransfers(rows.slice(0, 2)), [null, null]); // missing euro leg
    assert.deepEqual(sortPayments(rows.slice(0, 2), { categories: all }), Array(2).fill({ categoryId: null, source: null }));
    assert.deepEqual(ownTransfers(rows.slice(1)), [null, null]); // missing purchase
    assert.deepEqual(ownTransfers([{ ...rows[0], externalId: "OTHER" }, ...rows.slice(1)]), [null, null, null]);
    assert.deepEqual(ownTransfers([{ ...rows[0], currency: "EUR" }, ...rows.slice(1)]), [null, null, null]);
    assert.deepEqual(ownTransfers([{ ...rows[0], externalId: undefined }, ...rows.slice(1)]), [null, null, null]);
    assert.deepEqual(ownTransfers([rows[0], rows[1], { ...rows[2], raw: {} }]), [null, null, null]);
    assert.deepEqual(ownTransfers([rows[0], rows[2]]), [null, { rule: "paypal-conversion" }]); // same as dashboard
  }
});

test("conversion classification leaves the dashboard unchanged, including the euro cost and refund", () => {
  for (const english of [false, true]) for (const refund of [false, true]) {
    const rows = conversionRows(english, refund);
    const categories = [
      { name: "Clothes", icon: "Shirt", color: "#123456", excludeFromTotals: false },
      { name: "Own transfers", icon: "ArrowLeftRight", color: "#123456", excludeFromTotals: true },
    ];
    const before = rows.map((p, i) => ({ ...p, id: p.externalId, category: i === 0 ? "Clothes" : null }));
    const sorted = sortPayments(rows, { categories: all });
    const after = before.map((p, i) => ({ ...p, category: sorted[i].source === "structural" ? "Own transfers" : p.category }));
    const build = (transactions: typeof before) => buildDashboardSource({ transactions, categories, today: "2026-10-30" });
    assert.deepEqual(build(after), build(before));
    assert.deepEqual(build(after).transactions.map((p) => [p.id, p.amount]), [["PURCHASE", refund ? 25.7 : -25.7]]);
  }
});

test("conversion rows keep their structural rule before learning and account pairing", () => {
  const rows = conversionRows().map((p, i) => i === 0 ? p : { ...p, counterparty: "Eigenes Konto" });
  const learned = learn({}, rows[1], "clothes");
  assert.equal(sortPayments(rows, { categories: all, learned })[1].source, "structural");
  const otherAccount = { ...rows[2], source: "bank" as const, account: "giro", externalId: "BANK", raw: {}, amount: 25.7 };
  assert.deepEqual(ownTransfers([...rows, otherAccount]), [null, { rule: "paypal-conversion" }, { rule: "paypal-conversion" }, null]);
  const funding = { ...rows[0], description: "Bankgutschrift auf PayPal-Konto" };
  assert.deepEqual(ownTransfers([funding, ...rows.slice(1)]), [{ rule: "paypal" }, null, null]);
});

test("PayPal's withdrawals to the bank are structural transfers regardless of status, sign or learning", () => {
  for (const description of ["Von Nutzer eingeleitete Abbuchung", "User Initiated Withdrawal", "General Withdrawal - Bank Account", "Manual Withdrawal"]) {
    for (const status of ["Abgeschlossen", "Entfernt", "Ausstehend", "Completed", "Removed", "Pending"]) for (const amount of [-37, 37]) {
      const payment = { ...paypal("2026-10-08", amount, "", description), raw: { Status: status } };
      const learned = learn({}, payment, "clothes");
      assert.deepEqual(ownTransfers([payment]), [{ rule: "paypal" }]);
      assert.deepEqual(sortPayments([payment], { categories: [], learned }), [{ categoryId: OWN_TRANSFERS, source: "structural" }]);
      assert.deepEqual(sortPayments([payment], { categories: all, learned }), [{ categoryId: OWN_TRANSFERS, source: "structural" }]);
      assert.deepEqual(ownTransfers([{ ...payment, source: "bank" }]), [null]);
    }
  }
  const out = { ...paypal("2026-10-08", -37, "Eigenes Konto", "Unrelated"), raw: { Type: "User Initiated Withdrawal" } };
  const into = bank("2026-10-08", 37, "Eigenes Konto", "Umbuchung");
  assert.deepEqual(ownTransfers([out, into]), [{ rule: "paypal" }, null]); // account pairing must not overwrite it
});

test("withdrawals sorted as own transfers count as neither spending nor income in the dashboard", () => {
  const payments = [
    ...["Completed", "Removed", "Pending"].flatMap((Status) => [-37, 37].map((amount) =>
      ({ ...paypal("2026-10-08", amount, "", "User Initiated Withdrawal"), raw: { Status } }))),
    bank("2026-10-08", 37, "PayPal Europe", "PayPal withdrawal"),
    bank("2026-10-09", -9, "Penny"),
  ];
  const sorted = sortPayments(payments, { categories: all });
  const categories = all.map((c) => ({ name: c.id, icon: "Tag", color: "#123456", excludeFromTotals: c.kind === "transfer" }));
  const source = buildDashboardSource({ transactions: payments.map((p, i) => ({
    ...p, id: `withdrawal-test-${i}`, externalId: `withdrawal-test-${i}`, amount: p.amount!, date: p.date!, currency: p.currency!,
    description: p.description!, category: sorted[i].categoryId,
  })), categories, today: "2026-10-30" });
  assert.equal(source.categories.find((c) => c.name === OWN_TRANSFERS)?.kind, "transfer");
  const dashboard = buildDashboard(source);
  assert.equal(dashboard.total.expense, 9);
  assert.equal(dashboard.total.income, 0);
  assert.deepEqual(dashboard.overview.expense, [9]);
  assert.deepEqual(dashboard.overview.income, [0]);
  assert.ok(dashboard.transactions.slice(0, -1).every((p) => p.incomeBuckets.length === 0));
});

// ---- 2. Between accounts --------------------------------------------------------------------------------------

const GIRO = "DE89370400440532013000";
const TAGESGELD = "DE02120300000000202051";
const FRIEND = "DE75512108001245126199";
// A bank line on an account whose IBAN is known, with the other party's IBAN as the readers give it.
const ibanLine = (date: string, amount: number, account: "giro" | "tagesgeld" | "karte", accountIban: string | null,
  counterparty: string | null, description: string, counterpartyIban?: string): TransferPayment =>
  ({ ...bank(date, amount, counterparty, description, account), accountIban, ...(counterpartyIban ? { counterpartyIban } : {}) });

test("equal amounts alone do not pair: an unrelated 20.00 purchase and a friend's 20.00 stay what they are", () => {
  const payments = [
    ibanLine("2026-03-06", -20, "giro", GIRO, "Fiktiv Pizzeria", "Kartenzahlung"),
    ibanLine("2026-03-07", 20, "tagesgeld", TAGESGELD, "Max Mustermann", "Pizza von gestern", FRIEND),
  ];
  assert.deepEqual(ownTransfers(payments), [null, null]);
  assert.ok(sortPayments(payments, { categories: all }).every((r) => r.source !== "structural")); // left to the other rules
  // The friend's IBAN is not one of the person's accounts, and only one side saying "Umbuchung" is no proof either.
  assert.deepEqual(ownTransfers([{ ...payments[0], counterpartyIban: FRIEND }, payments[1]]), [null, null]);
  assert.deepEqual(ownTransfers([{ ...payments[0], description: "Umbuchung" }, payments[1]]), [null, null]);
});

test("a Girokonto → Tagesgeld move pairs when one side names the other account's IBAN, either way round", () => {
  const out = ibanLine("2026-03-01", -500, "giro", GIRO, "Patrik Tagesgeld", "Sparen", TAGESGELD);
  const into = ibanLine("2026-03-02", 500, "tagesgeld", TAGESGELD, "Girokonto", "Gutschrift");
  const groceries = ibanLine("2026-03-02", -42.5, "giro", GIRO, "REWE Markt GmbH", "");
  assert.deepEqual(ownTransfers([out, into, groceries]), [{ rule: "accounts", pairedWith: 1 }, { rule: "accounts", pairedWith: 0 }, null]);
  assert.deepEqual(sources([out, into, groceries]), [OWN_TRANSFERS, OWN_TRANSFERS, "groceries"]);
  // Only the incoming side names the giro account; the IBAN as a reader may print it, with spaces and in lower case.
  const plainOut = { ...out, counterpartyIban: undefined };
  const namedIn = { ...into, counterpartyIban: "de89 3704 0044 0532 0130 00" };
  assert.deepEqual(ownTransfers([plainOut, namedIn]).map((r) => r?.rule ?? null), ["accounts", "accounts"]);
  // An account key that is the IBAN itself needs no accountIban.
  const byKey = [{ ...out, account: GIRO, accountIban: null }, { ...into, account: TAGESGELD, accountIban: null }];
  assert.deepEqual(ownTransfers(byKey).map((r) => r?.rule ?? null), ["accounts", "accounts"]);
  // Without the account's IBAN there is nothing to compare with.
  assert.deepEqual(ownTransfers([out, { ...into, accountIban: null }]), [null, null]);
});

test("both sides' own words are proof too: Umbuchung, Übertrag, Kontoübertrag, eigenes Konto, own account", () => {
  for (const [a, b] of [
    ["Umbuchung", "Umbuchung"], ["Übertrag auf Tagesgeld", "Übertrag vom Girokonto"], ["Eigenübertrag", "KONTOUEBERTRAG"],
    ["Überweisung auf eigenes Konto", "Gutschrift vom eigenen Konto"], ["Transfer to own account", "Own account transfer"],
  ]) {
    const pair = [bank("2026-03-04", -75, null, a, "giro"), bank("2026-03-04", 75, null, b, "tagesgeld")];
    assert.deepEqual(ownTransfers(pair).map((r) => r?.rule ?? null), ["accounts", "accounts"], `${a} / ${b}`);
  }
  for (const text of ["Übertragung Kundendaten", "Datenübertrag GmbH", "Kontoauszug", "Konto 4711", "Account fee"]) {
    assert.equal(saysOwnTransfer({ description: text }), false, text);
  }
  assert.equal(saysOwnTransfer({ counterparty: "Eigenes Konto", description: "Sparrate" }), true);
  assert.equal(saysOwnTransfer({ bookingText: "UMBUCHUNG" }), true);
  assert.equal(saysOwnTransfer({ description: "Übertrag" }), true); // a decomposed Ü
});

test("two equal moves on one day pair one-to-one; each payment pairs at most once", () => {
  const payments = [
    ibanLine("2026-03-05", -250, "giro", GIRO, "Tagesgeld", "Sparen", TAGESGELD),
    ibanLine("2026-03-05", -250, "giro", GIRO, "Tagesgeld", "Sparen", TAGESGELD),
    ibanLine("2026-03-05", 250, "tagesgeld", TAGESGELD, "Girokonto", "Einzahlung"),
    ibanLine("2026-03-05", 250, "tagesgeld", TAGESGELD, "Girokonto", "Einzahlung"),
    ibanLine("2026-03-05", 250, "tagesgeld", TAGESGELD, "Girokonto", "Einzahlung"), // a third with no partner left
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
    { ...bank("2026-02-27T00:00:00.000Z", -60, null, "Umbuchung", "giro") }, bank("2026-03-02", 60, null, "Umbuchung", "tagesgeld"),
  ]).map((r) => r?.rule ?? null), ["accounts", "accounts"]);
});

test("near-matches do not pair even with proof: four days, one cent, one account, the same sign, another currency, no account", () => {
  const out = bank("2026-03-10", -80, null, "Umbuchung", "giro");
  for (const partner of [
    bank("2026-03-14", 80, null, "Umbuchung", "tagesgeld"), // four days later
    bank("2026-03-06", 80, null, "Umbuchung", "tagesgeld"), // four days earlier
    bank("2026-03-10", 80.01, null, "Umbuchung", "tagesgeld"), // one cent more
    bank("2026-03-10", 80, null, "Umbuchung", "giro"), // back on the same account
    bank("2026-03-10", -80, null, "Umbuchung", "tagesgeld"), // the same sign
    { ...bank("2026-03-10", 80, null, "Umbuchung", "karte"), currency: "USD" }, // another currency
    { ...bank("2026-03-10", 80, null, "Umbuchung"), account: null }, // no account known
  ]) assert.deepEqual(ownTransfers([out, partner]), [null, null], JSON.stringify(partner));
  // Payments without amount or date never pair, and amounts of zero have no direction.
  assert.deepEqual(ownTransfers([{ account: "giro", amount: -5, description: "Umbuchung" }, { account: "karte", amount: 5, description: "Umbuchung" }]), [null, null]);
  assert.deepEqual(ownTransfers([bank("2026-03-10", 0, "", "Umbuchung", "giro"), bank("2026-03-10", -0, "", "Umbuchung", "karte")]), [null, null]);
});

test("one account only: nothing pairs", () => {
  assert.deepEqual(ownTransfers([bank("2026-03-10", -20, "Max Mustermann", "Pizza"), bank("2026-03-11", 20, "Max Mustermann", "Pizza zurück")]), [null, null]);
  assert.deepEqual(ownTransfers([bank("2026-03-10", -20, null, "Umbuchung"), bank("2026-03-11", 20, null, "Umbuchung")]), [null, null]);
});

test("PayPal's funding rows are own transfers by themselves, German and English, so they cannot pair with a stranger", () => {
  const payments = [
    bank("2026-03-03", -18.9, "PayPal Europe S.a.r.l. et Cie S.C.A", "PP.4711.PP . Ihr Einkauf bei Märchenladen"),
    paypal("2026-03-03", -18.9, "Märchenladen"),
    paypal("2026-03-03", 18.9, "Märchenladen", "Bankgutschrift auf PayPal-Konto"),
    bank("2026-03-04", -18.9, "Fiktivbüro", "Rechnung 17", "karte"),
  ];
  assert.deepEqual(ownTransfers(payments), [{ rule: "paypal" }, null, { rule: "paypal" }, null]);
  // Learning the shop from the purchase does not pull the funding row (which PayPal names after the shop) along.
  assert.deepEqual(sources(payments, learn({}, payments[1], "clothes")), [OWN_TRANSFERS, "clothes", OWN_TRANSFERS, null]);
  // English exports: the type in the description, or only in the original row when PayPal filled in the shop.
  for (const row of [
    paypal("2026-03-03", 18.9, "", "Bank Deposit to PP Account "),
    { ...paypal("2026-03-03", 18.9, "Fiktiv Online Shop"), raw: { Type: "General Card Deposit" } },
    { ...paypal("2026-03-03", 18.9, "Fiktiv Online Shop"), raw: { Description: "General Credit Card Deposit" } },
  ]) assert.deepEqual(ownTransfers([row]), [{ rule: "paypal" }], JSON.stringify(row));
  // A bank line with the same words is not PayPal's export, and PayPal's purchases are not funding.
  assert.equal(isPaypalFundingRow(bank("2026-03-03", 18.9, null, "Bankgutschrift auf PayPal-Konto")), false);
  assert.equal(isPaypalFundingRow({ ...paypal("2026-03-03", -18.9, "Fiktiv Online Shop"), raw: { Type: "Express Checkout Payment" } }), false);
});

test("structural results use the built-in category even when the person's list is empty", () => {
  const payments = [bank("2026-03-01", -500, null, "Umbuchung", "giro"), bank("2026-03-01", 500, null, "Umbuchung", "tagesgeld")];
  assert.deepEqual(sortPayments(payments, { categories: [] }), [
    { categoryId: OWN_TRANSFERS, source: "structural" }, { categoryId: OWN_TRANSFERS, source: "structural" },
  ]);
});
