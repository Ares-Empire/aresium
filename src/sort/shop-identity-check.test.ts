import assert from "node:assert/strict";
import { test } from "node:test";
import { compareShopSorting } from "../../scripts/check-shop-sorting.js";
import { merchantKey, sortPayments, type SortingPayment, type SortResult } from "../engine/index.js";

test("the server comparison accepts new identity learning but rejects changed exact and structural rules", () => {
  const snapshot = { payments: ["Vinted UAB", "REWE", "PayPal"].map((counterparty) => ({ counterparty })),
    categories: [{ id: "custom" }], learned: { rewe: "custom", "mgp vinted - kleiderkreisel": "custom" } };
  const old: SortResult[] = [{ categoryId: null, source: null }, { categoryId: "custom", source: "learned" },
    { categoryId: "own-transfers", source: "structural" }];
  const next: SortResult[] = [{ categoryId: "custom", source: "learned" }, ...old.slice(1)];
  const result = compareShopSorting({ merchantKey, sortPayments: () => old }, { merchantKey, sortPayments: () => next }, snapshot);
  assert.equal(result.newlySorted, 1);
  assert.equal(result.identityLearningChanges, 1);
  assert.equal(result.unexpectedSortingChanges, 0);
  assert.equal(result.unexpectedKeyChanges, 0);
  const broken = compareShopSorting({ merchantKey, sortPayments: () => old },
    { merchantKey, sortPayments: () => next.map(() => ({ categoryId: null, source: null })) }, snapshot);
  assert.equal(broken.lostCategories, 2);
  assert.equal(broken.unexpectedSortingChanges, 2);
});

test("the server comparison flags non-card key changes and isolates card key and town changes for review", () => {
  const card = { description: "FIKTIVSHOP          USA MUSTERSTADT            USD 7,43 Kurs: 1,086700 Umsatz vom 09.10.2026 MC Hauptkarte" };
  const payments = [card, { counterparty: "Penny Musterstadt" }, { counterparty: "Other" }];
  const old = { merchantKey: (payment: SortingPayment) => payment === card ? "fiktivshop usa musterstadt usd kurs" : merchantKey(payment),
    sortPayments: (): SortResult[] => payments.map(() => ({ categoryId: null, source: null })) };
  const next = { merchantKey, sortPayments };
  const result = compareShopSorting(old, next, { payments, categories: [{ id: "groceries" }],
    learned: { fiktivshop: "groceries" } });
  assert.equal(result.keyChanges, 1);
  assert.equal(result.cardKeySortingChanges, 1);
  assert.equal(result.cardOrTownStarterChanges, 1);
  assert.equal(result.unexpectedSortingChanges, 0);
  const broken = compareShopSorting(next, { ...next, merchantKey: () => "changed" }, { payments, categories: [] });
  assert.equal(broken.unexpectedKeyChanges, 2);
});
