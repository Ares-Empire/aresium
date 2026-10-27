import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine } from "../../scripts/build-engine.js";
import { buildDashboard } from "../data/dashboard.js";
import { DEFAULT_CATEGORIES } from "./categories.js";
import * as engine from "./index.js";
import { starterCategory } from "./sorting/starter-rules.js";
import { buildDashboardSource, type SourceCategory, type SourcePayment, type SourceReceipt } from "./source.js";

// ── Without receipts nothing changes (Patrik's server never sends them) ──────────────────────────────────

// Every payment of the existing bank fixtures (made-up payments in real formats), sorted by the shop list.
async function fixturePayments(): Promise<SourcePayment[]> {
  const root = new URL("fixtures/", import.meta.url);
  const banks = new URL("banks/", root);
  const files = [
    ...(await readdir(root)).filter((f) => f.endsWith(".expected.json")).map((f) => new URL(f, root)),
    ...(await readdir(banks)).filter((f) => f.endsWith(".expected.json")).map((f) => new URL(f, banks)),
  ].sort((a, b) => (a.href < b.href ? -1 : 1));
  const payments: SourcePayment[] = [];
  for (const url of files) {
    const file = JSON.parse(await readFile(url, "utf8"));
    file.transactions.forEach((t: Record<string, unknown>, i: number) => {
      const categoryId = starterCategory({ counterparty: t.counterparty as string | null, description: t.description as string, amount: Number(t.amount) }, DEFAULT_CATEGORIES);
      payments.push({
        id: `${url.pathname.split("/").at(-1)}#${i}`, externalId: String(t.externalId), date: String(t.bookingDate),
        amount: Number(t.amount), currency: String(t.currency), balance: t.balance == null ? null : Number(t.balance),
        description: String(t.description ?? ""), counterparty: (t.counterparty as string | null) ?? null, raw: t.raw,
        category: DEFAULT_CATEGORIES.find((c) => c.id === categoryId)?.name.en ?? null,
      });
    });
  }
  return payments;
}
const fixtureCategories: SourceCategory[] = DEFAULT_CATEGORIES.map((c) => ({
  name: c.name.en, icon: "Tag", color: "#123456", excludeFromTotals: c.kind === "transfer",
}));
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("no receipts: the dashboard of every bank fixture is the same as before receipts existed", async () => {
  const input = { transactions: await fixturePayments(), categories: fixtureCategories, today: "2026-03-15" };
  assert.equal(input.transactions.length, 128);
  assert.ok(input.transactions.some((p) => p.category === "Cash"), "the fixtures hold cash withdrawals");
  const dashboard = buildDashboard(buildDashboardSource(input));
  // The hash of this dashboard's JSON as main computed it before brief 30 (commit 612b96a), 477,944 characters.
  assert.equal(sha256(dashboard), "90a059bc6ad8738592ba9a303ee04fd3dc816c52c4ac0f4a7f9f4f8df7f3d8b5");
  assert.deepEqual(buildDashboardSource({ ...input, receipts: [] }), buildDashboardSource(input));
});

// ── Receipts counted once ────────────────────────────────────────────────────────────────────────────────

const look = (name: string, excludeFromTotals = false): SourceCategory => ({ name, icon: "Tag", color: "#123456", excludeFromTotals });
const categories = [look("Groceries"), look("Coffee & snacks"), look("Cash"), look("Income"), look("Own transfers", true)];
let n = 0;
const pay = (date: string, amount: number, fields: Partial<SourcePayment> = {}): SourcePayment => ({
  id: `p${++n}`, externalId: `x${n}`, date, amount, currency: "EUR", description: "Kartenzahlung Fiktivmarkt",
  counterparty: "Fiktivmarkt", category: "Groceries", ...fields,
});
const withdrawal = (date: string, amount: number, fields: Partial<SourcePayment> = {}) =>
  pay(date, amount, { counterparty: null, description: "Bargeldauszahlung Geldautomat Fiktivbank", category: "Cash", ...fields });
const receipt = (id: string, date: string, total: number, method: "card" | "cash", fields: Partial<SourceReceipt> = {}): SourceReceipt => ({
  id, date, total, currency: "EUR", method, category: "Groceries", shop: "Fiktivmarkt", paymentId: null, ...fields,
});
const both = (transactions: SourcePayment[], receipts: SourceReceipt[], today = "2026-02-27") => {
  const source = buildDashboardSource({ transactions, categories, today, receipts });
  return { source, dashboard: buildDashboard(source) };
};
const spentIn = (d: ReturnType<typeof buildDashboard>, month: string, category: string) =>
  d.byMonth[month].categories.find((c) => c.name === category)?.total ?? 0;

test("a card receipt joined to its bank payment adds nothing: the payment counts as it is", () => {
  const salary = pay("2026-02-01", 1500, { category: "Income" });
  const shop = pay("2026-02-03", -23.4, { id: "bank" });
  const without = buildDashboardSource({ transactions: [salary, shop], categories, today: "2026-02-27" });
  const { source } = both([salary, shop], [receipt("r1", "2026-02-02", 23.4, "card", { paymentId: "bank", category: "Coffee & snacks" })]);
  assert.deepEqual(source, without);
});

test("a card receipt not joined yet counts on its own, provisional, until its bank payment comes", () => {
  const { source, dashboard } = both([pay("2026-02-01", 1500, { category: "Income" })],
    [receipt("r1", "2026-02-05", 23.4, "card", { shop: "REWE" }), receipt("r2", "2026-02-06", 5, "card", { paymentId: "gone" })]);
  assert.deepEqual(source.transactions.slice(1), [
    { id: "r1", date: "2026-02-05", amount: -23.4, categoryName: "Groceries", tags: [], place: "REWE", city: "", receiptId: "r1", provisional: true },
    { id: "r2", date: "2026-02-06", amount: -5, categoryName: "Groceries", tags: [], place: "Fiktivmarkt", city: "", receiptId: "r2", provisional: true },
  ]);
  assert.equal(dashboard.total.expense, 28.4);
  const txn = dashboard.transactions.find((t) => t.id === "r1")!;
  assert.deepEqual([txn.provisional, txn.receiptId, txn.categoriesIn], [true, "r1", ["Groceries"]]);
  assert.equal(dashboard.transactions[0].provisional, undefined, "payments carry no receipt fields");
});

test("cash receipts take their amounts from an earlier withdrawal, across months; the total spending stays the same", () => {
  const cash = withdrawal("2026-01-28", -100, { id: "atm" });
  const before = buildDashboard(buildDashboardSource({ transactions: [cash], categories, today: "2026-02-27" }));
  const { source, dashboard } = both([cash], [
    receipt("bakery", "2026-01-30", 20, "cash", { category: "Coffee & snacks", shop: "Bäckerei Sonnenschein" }),
    receipt("market", "2026-02-03", 50, "cash", { shop: "Wochenmarkt" }),
  ]);
  // One row for the withdrawal, in its own category and month, positive, naming the receipts.
  assert.deepEqual(source.transactions.find((t) => t.coveredBy), {
    id: "atm:covered", date: "2026-01-28", amount: 70, categoryName: "Cash", tags: [], place: "Covered by receipts", city: "",
    coveredBy: ["bakery", "market"],
  });
  assert.deepEqual(source.transactions.map((t) => t.id), ["atm", "atm:covered", "bakery", "market"]);
  assert.equal(spentIn(dashboard, "2026-01", "Cash"), 30); // only what has no receipt
  assert.equal(spentIn(dashboard, "2026-01", "Coffee & snacks"), 20);
  assert.equal(spentIn(dashboard, "2026-02", "Groceries"), 50);
  assert.deepEqual([dashboard.byMonth["2026-01"].expense, dashboard.byMonth["2026-02"].expense], [50, 50]);
  assert.equal(dashboard.total.expense, before.total.expense);
  assert.equal(dashboard.total.income, 0, "covered cash is never income");
  const covered = dashboard.transactions.find((t) => t.id === "atm:covered")!;
  assert.deepEqual([covered.incomeBuckets, covered.coveredBy], [[], ["bakery", "market"]]);
});

test("a cash receipt bigger than what is left counts the rest as spending of its own; later withdrawals do not cover it", () => {
  const { source, dashboard } = both([withdrawal("2026-02-02", -50, { id: "first" }), withdrawal("2026-02-20", -40, { id: "later" })],
    [receipt("big", "2026-02-10", 80, "cash")]);
  assert.deepEqual(source.transactions.filter((t) => t.coveredBy).map((t) => [t.id, t.amount]), [["first:covered", 50]]);
  assert.equal(spentIn(dashboard, "2026-02", "Cash"), 40);
  assert.equal(spentIn(dashboard, "2026-02", "Groceries"), 80);
  assert.equal(dashboard.total.expense, 120); // 90 withdrawn + 30 of the receipt from elsewhere
});

test("the latest withdrawal before the receipt first, never more than is left; whatever category the withdrawal is in", () => {
  const { source } = both([
    withdrawal("2026-02-01", -30, { id: "old", category: "Groceries" }), withdrawal("2026-02-03", -50, { id: "new" }),
    pay("2026-02-03", -60, { id: "shop" }),
  ], [receipt("a", "2026-02-04", 20, "cash"), receipt("b", "2026-02-05", 25, "cash"), receipt("c", "2026-02-06", 40, "cash")]);
  // a and b come out of the newer withdrawal; c takes its last 5, then 30 from the older one; c's last 5 are its own.
  assert.deepEqual(source.transactions.filter((t) => t.coveredBy).map((t) => [t.id, t.amount, t.categoryName, t.coveredBy]),
    [["old:covered", 30, "Groceries", ["c"]], ["new:covered", 50, "Cash", ["a", "b", "c"]]]);
});

test("a receipt comes out of this month's withdrawal, not cash left from months ago; at most about three months back", () => {
  const { source, dashboard } = both([withdrawal("2026-02-01", -100, { id: "feb" }), withdrawal("2026-10-01", -100, { id: "oct" })],
    [receipt("cafe", "2026-10-15", 30, "cash"), receipt("late", "2027-02-20", 10, "cash")]);
  assert.deepEqual(source.transactions.filter((t) => t.coveredBy).map((t) => [t.id, t.amount, t.coveredBy]), [["oct:covered", 30, ["cafe"]]]);
  assert.equal(spentIn(dashboard, "2026-02", "Cash"), 100, "February does not change when a receipt from October comes in");
  // "late" is more than CASH_LOOKBACK_DAYS after October's withdrawal: cash from elsewhere, counted on its own.
  assert.equal(dashboard.total.expense, 210);
});

test("cash with the withdrawal Not sorted: the covered row lowers Not sorted, and is never Other income", () => {
  const { dashboard } = both([withdrawal("2026-02-02", -100, { id: "atm", category: null })], [receipt("r", "2026-02-05", 30, "cash")]);
  assert.equal(spentIn(dashboard, "2026-02", "Uncategorised"), 70);
  assert.equal(dashboard.total.expense, 100);
  assert.equal(dashboard.total.income, 0);
  assert.deepEqual(dashboard.total.incomeBuckets, []);
  assert.deepEqual(dashboard.transactions.find((t) => t.id === "atm:covered")?.categoriesIn, ["Uncategorised"]);
});

test("a withdrawal in a transfer category: the receipts are the spending, nothing turns into income", () => {
  const { dashboard } = both([withdrawal("2026-02-02", -100, { category: "Own transfers" })], [receipt("r", "2026-02-05", 30, "cash")]);
  assert.deepEqual([dashboard.total.expense, dashboard.total.income], [30, 0]);
});

test("receipts in another currency wait for their euro amount; a receipt with a bad date or method is refused by id", () => {
  const { source } = both([pay("2026-02-01", -1)], [receipt("gbp", "2026-02-02", 12.5, "card", { currency: "GBP" }),
    receipt("chf", "2026-02-02", 9, "cash", { currency: "CHF" })]);
  assert.deepEqual(source.transactions.map((t) => t.id), ["p" + n]);
  assert.throws(() => both([], [receipt("bad", "02.02.2026", 1, "cash")]), /^Error: Receipt bad: /);
  assert.throws(() => both([], [receipt("odd", "2026-02-02", 1, "voucher" as "cash")]), /^Error: Receipt odd: /);
  assert.throws(() => both([], [receipt("nan", "2026-02-02", Number.NaN, "cash")]), /^Error: Receipt nan: /);
});

test("receipts alone make the months and count", () => {
  const { source, dashboard } = both([], [receipt("r", "2026-01-15", 9.5, "cash", { category: null }), receipt("s", "2026-02-03", 4, "card")], "2026-02-10");
  assert.deepEqual(source.months.map((m) => [m.key, m.partial]), [["2026-01", false], ["2026-02", true]]);
  assert.deepEqual([dashboard.total.expense, spentIn(dashboard, "2026-01", "Uncategorised"), spentIn(dashboard, "2026-02", "Groceries")], [13.5, 9.5, 4]);
});

const context = createContext({}); // No Node require/process/Buffer or web APIs injected.
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the bundle counts receipts as the engine does", () => {
  const input = { categories, today: "2026-02-27", transactions: [withdrawal("2026-01-28", -100), pay("2026-02-03", -23.4, { id: "bank" })],
    receipts: [receipt("a", "2026-01-30", 20, "cash"), receipt("b", "2026-02-02", 23.4, "card", { paymentId: "bank" }), receipt("c", "2026-02-04", 7, "card")] };
  const direct = buildDashboardSource(input);
  assert.deepEqual(json(bundled.buildDashboardSource(input)), json(direct));
  assert.deepEqual(json(bundled.buildDashboard(bundled.buildDashboardSource(input))), json(buildDashboard(direct)));
});
