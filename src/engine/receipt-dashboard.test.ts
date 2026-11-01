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

// The names the hash below was taken with. Brief 32 renamed the category `cash` to "Cash withdrawals"; the input keeps
// the old name, so that the hash still proves the counting did not change.
const nameAtHash = (c: (typeof DEFAULT_CATEGORIES)[number]) => (c.id === "cash" ? "Cash" : c.name.en);

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
        category: ((c) => (c ? nameAtHash(c) : null))(DEFAULT_CATEGORIES.find((c) => c.id === categoryId)),
      });
    });
  }
  return payments;
}
const fixtureCategories: SourceCategory[] = DEFAULT_CATEGORIES.map((c) => ({
  name: nameAtHash(c), icon: "Tag", color: "#123456", excludeFromTotals: c.kind === "transfer",
}));
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// The hash of the fixtures' dashboard JSON as main computed it before brief 30 (commit 612b96a), 477,944 characters.
const HASH_BEFORE_RECEIPTS = "90a059bc6ad8738592ba9a303ee04fd3dc816c52c4ac0f4a7f9f4f8df7f3d8b5";
const SOURCE_HASH_BEFORE_SIDES = "9142fa1a3d8ceda53a989d06dff88c68a8c11b129d4053f306e522b3ef5de90d";

// Brief 68 adds transfers to money-out choices for everyone. Apart from that addition these fixtures (no income
// money out) still match the original dashboard byte for byte; keep the old hash as the oracle.
function assertLegacyDashboard(dashboard: ReturnType<typeof buildDashboard>) {
  const transfers = dashboard.categories.filter((c) => c.kind === "transfer").map((c) => c.name);
  const spend = dashboard.pick.spend.filter((n) => !transfers.includes(n));
  assert.deepEqual(dashboard.pick.spend, [...spend, ...transfers.sort((a, b) => a.localeCompare(b))]);
  assert.equal(sha256({ ...dashboard, pick: { ...dashboard.pick, spend } }), HASH_BEFORE_RECEIPTS);
}

test("no receipts: the dashboard of every bank fixture is the same as before receipts existed", async () => {
  const input = { transactions: await fixturePayments(), categories: fixtureCategories, today: "2026-03-15" };
  assert.equal(input.transactions.length, 128);
  assert.ok(input.transactions.some((p) => p.category === "Cash"), "the fixtures hold cash withdrawals");
  const source = buildDashboardSource(input);
  assert.equal(sha256(source), SOURCE_HASH_BEFORE_SIDES, "source JSON without side fields stays byte-identical");
  const dashboard = buildDashboard(source);
  assertLegacyDashboard(dashboard);
  // The server's JSON gains nothing of the Cash page (brief 32).
  assert.equal("cash" in dashboard, false);
  assert.equal(dashboard.transactions.some((t) => "cashWithdrawal" in t), false);
});

test("receipts given but none stored: the same numbers; only the Cash page and the withdrawals' marks are added", async () => {
  const input = { transactions: await fixturePayments(), categories: fixtureCategories, today: "2026-03-15", receipts: [] };
  const { cash, ...dashboard } = buildDashboard(buildDashboardSource(input));
  const unmarked = { ...dashboard, transactions: dashboard.transactions.map(({ cashWithdrawal, ...t }) => t) };
  assertLegacyDashboard(unmarked);
  const marked = dashboard.transactions.filter((t) => t.cashWithdrawal).map((t) => t.id);
  assert.ok(marked.length > 0);
  assert.deepEqual(cash!.movements.map((m) => [m.id, m.kind, m.paidFrom, m.coveredBy]), marked.map((id) => [id, "withdrawal", null, []]));
  for (const month of Object.values(cash!.months)) assert.deepEqual([month.received, month.spent, month.unaccounted], [0, 0, month.withdrawn]);
});

// ── Receipts counted once ────────────────────────────────────────────────────────────────────────────────

const look = (name: string, excludeFromTotals = false): SourceCategory => ({ name, icon: "Tag", color: "#123456", excludeFromTotals });
const categories = [look("Groceries"), look("Coffee & snacks"), look("Cash"), look("Income"), look("Own transfers", true),
  look("Parents & family")];
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
  const { source: { cash, ...source } } = both([salary, shop], [receipt("r1", "2026-02-02", 23.4, "card", { paymentId: "bank", category: "Coffee & snacks" })]);
  assert.deepEqual(source, without);
  assert.deepEqual(cash, { months: {}, movements: [] });
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

// ── Cash beyond the bank (brief 32, D9): cash received, entries by hand, where cash came from, the Cash page ──

const gift = (id: string, date: string, total: number, fields: Partial<SourceReceipt> = {}) =>
  receipt(id, date, total, "cash", { direction: "in", kind: "manual", category: "Parents & family", shop: "Geburtstag", ...fields });
const coveredRows = (source: ReturnType<typeof buildDashboardSource>) =>
  source.transactions.filter((t) => t.coveredBy).map((t) => [t.id, t.amount, t.coveredBy]);
const tookFrom = (source: ReturnType<typeof buildDashboardSource>) =>
  Object.fromEntries(source.cash!.movements.filter((m) => m.paidFrom).map((m) => [m.id, m.paidFrom]));

test("a gift, then a cash receipt paid from it: the gift is income, the receipt spending, the withdrawal untouched", () => {
  const { source, dashboard } = both([withdrawal("2026-02-05", -100, { id: "atm" })], [
    gift("gift", "2026-02-01", 50),
    receipt("flea", "2026-02-08", 20, "cash", { kind: "manual", shop: "Flohmarkt", paidFrom: "gift" }),
  ]);
  assert.deepEqual(coveredRows(source), [], "a received-cash source needs no covered row; the withdrawal gave nothing");
  assert.deepEqual(source.transactions.find((t) => t.id === "gift"), {
    id: "gift", date: "2026-02-01", amount: 50, categoryName: "Parents & family", tags: [], place: "Geburtstag", city: "", receiptId: "gift",
  });
  assert.equal(spentIn(dashboard, "2026-02", "Cash"), 100);
  assert.equal(spentIn(dashboard, "2026-02", "Groceries"), 20);
  assert.deepEqual([dashboard.total.expense, dashboard.total.income], [120, 50]);
  assert.deepEqual(dashboard.total.incomeBuckets, [{ name: "Parents & family", total: 50 }]);
  assert.deepEqual(tookFrom(source), { flea: ["gift"] });
});

test("cash received is a source like a withdrawal: automatic takes the latest source on or before the day", () => {
  const { source, dashboard } = both([withdrawal("2026-02-01", -100, { id: "atm" })],
    [gift("gift", "2026-02-10", 30), receipt("a", "2026-02-12", 40, "cash"), receipt("b", "2026-02-12", 10, "cash")]);
  // a: 30 from the gift (the latest), 10 from the withdrawal; b: 10 from the withdrawal.
  assert.deepEqual(tookFrom(source), { a: ["gift", "atm"], b: ["atm"] });
  assert.deepEqual(coveredRows(source), [["atm:covered", 20, ["a", "b"]]]);
  assert.deepEqual([spentIn(dashboard, "2026-02", "Cash"), dashboard.total.expense, dashboard.total.income], [80, 130, 30]);
});

test("paidFrom naming a withdrawal: that one, not the latest; also further back than the automatic three months", () => {
  const { source } = both([
    withdrawal("2026-01-02", -50, { id: "jan" }), withdrawal("2026-05-01", -50, { id: "may" }), withdrawal("2026-05-10", -50, { id: "may10" }),
  ], [receipt("old", "2026-05-12", 30, "cash", { paidFrom: "jan" }), receipt("chosen", "2026-05-13", 10, "cash", { paidFrom: "may" })]);
  assert.deepEqual(tookFrom(source), { old: ["jan"], chosen: ["may"] });
  assert.deepEqual(coveredRows(source), [["jan:covered", 30, ["old"]], ["may:covered", 10, ["chosen"]]]);
});

test("paidFrom naming a source with too little left: what it has, the rest automatic", () => {
  const { source, dashboard } = both([withdrawal("2026-02-05", -100, { id: "atm" })],
    [gift("gift", "2026-02-01", 20), receipt("a", "2026-02-06", 30, "cash", { paidFrom: "gift" }), receipt("b", "2026-02-07", 5, "cash", { paidFrom: "gift" })]);
  // a: the gift's 20, then 10 from the withdrawal; b: the gift is empty, so all from the withdrawal.
  assert.deepEqual(tookFrom(source), { a: ["gift", "atm"], b: ["atm"] });
  assert.deepEqual(coveredRows(source), [["atm:covered", 15, ["a", "b"]]]);
  assert.deepEqual(source.cash!.movements.filter((m) => m.coveredBy).map((m) => [m.id, m.left]), [["gift", 0], ["atm", 85]]);
  assert.equal(dashboard.total.expense, 120);
});

test("paidFrom naming nothing (deleted, a wrong id, not a source) or a source after its day is ignored: automatic", () => {
  const { source } = both([
    withdrawal("2026-02-01", -100, { id: "atm" }), pay("2026-02-02", -12, { id: "shop" }), withdrawal("2026-02-20", -100, { id: "later" }),
  ], [
    receipt("deleted", "2026-02-05", 10, "cash", { paidFrom: "gone" }),
    receipt("card", "2026-02-05", 4, "card"),
    receipt("notSource", "2026-02-06", 5, "cash", { paidFrom: "shop" }),
    receipt("aCard", "2026-02-06", 6, "cash", { paidFrom: "card" }),
    receipt("future", "2026-02-07", 7, "cash", { paidFrom: "later" }),
  ]);
  assert.deepEqual(tookFrom(source), { deleted: ["atm"], notSource: ["atm"], aCard: ["atm"], future: ["atm"] });
  assert.deepEqual(coveredRows(source), [["atm:covered", 28, ["deleted", "notSource", "aCard", "future"]]]);
});

test("cash received with no category: Other income once, never Not sorted spending, never covered", () => {
  const { source, dashboard } = both([withdrawal("2026-02-01", -100, { id: "atm", category: null })],
    [gift("sold", "2026-02-03", 40, { category: null, shop: "Verkauf Fahrrad" }), receipt("r", "2026-02-04", 10, "cash")]);
  assert.deepEqual(tookFrom(source), { r: ["sold"] });
  assert.deepEqual(coveredRows(source), []);
  const sold = dashboard.transactions.find((t) => t.id === "sold")!;
  assert.deepEqual([sold.categoryName, sold.categoriesIn, sold.incomeBuckets, sold.coveredBy], ["Uncategorised", [], ["Other"], undefined]);
  assert.deepEqual(dashboard.total.incomeBuckets, [{ name: "Other", total: 40 }]);
  assert.equal(dashboard.total.income, 40);
  assert.equal(spentIn(dashboard, "2026-02", "Uncategorised"), 100, "only the withdrawal: the gift does not lower it");
  assert.equal(dashboard.total.expense, 110);
});

test("a cash entry by hand works exactly like a cash receipt; only the Cash page tells them apart", () => {
  const transactions = [withdrawal("2026-02-01", -100, { id: "atm" })];
  const manual = both(transactions, [receipt("m", "2026-02-03", 20, "cash", { kind: "manual", shop: "Flohmarkt", category: null })]);
  const read = both(transactions, [receipt("m", "2026-02-03", 20, "cash", { shop: "Flohmarkt", category: null })]);
  assert.deepEqual(manual.source.transactions, read.source.transactions);
  assert.deepEqual(manual.dashboard.total, read.dashboard.total);
  assert.deepEqual([manual.source.cash!.movements[1].kind, read.source.cash!.movements[1].kind], ["manual", "receipt"]);
  assert.deepEqual(coveredRows(manual.source), [["atm:covered", 20, ["m"]]]);
});

test("the Cash page over two months: every movement from the wallet's side, and each month's sums; it counts nowhere", () => {
  const transactions = [
    pay("2026-01-01", 1500, { id: "salary", category: "Income" }),
    withdrawal("2026-01-10", -100, { id: "atm1" }), pay("2026-01-11", -23.4, { id: "bank" }), withdrawal("2026-02-15", -60, { id: "atm2" }),
  ];
  const { source, dashboard } = both(transactions, [
    receipt("r1", "2026-01-12", 30, "cash", { category: "Coffee & snacks", shop: "Bäckerei Sonnenschein" }),
    gift("gift", "2026-01-20", 50),
    receipt("r2", "2026-02-02", 70, "cash", { shop: "Wochenmarkt" }),
    receipt("m", "2026-02-20", 10, "cash", { kind: "manual", shop: "Flohmarkt", category: null }),
    receipt("joined", "2026-01-11", 23.4, "card", { paymentId: "bank" }), // card: not cash
    receipt("waiting", "2026-02-21", 5, "card"), // card: not cash
    gift("francs", "2026-02-22", 20, { currency: "CHF" }), // waits for its euro amount
  ]);
  assert.deepEqual(source.cash, {
    months: {
      "2026-01": { withdrawn: 100, received: 50, spent: 30, unaccounted: 50 },
      "2026-02": { withdrawn: 60, received: 0, spent: 80, unaccounted: 50 },
    },
    movements: [
      { id: "atm1", date: "2026-01-10", amount: 100, kind: "withdrawal", place: "Bargeldauszahlung Geldautomat Fiktivbank", category: "Cash",
        paidFrom: null, coveredBy: ["r1", "r2"], left: 50 },
      { id: "r1", date: "2026-01-12", amount: -30, kind: "receipt", place: "Bäckerei Sonnenschein", category: "Coffee & snacks",
        paidFrom: ["atm1"], coveredBy: null, left: null },
      { id: "gift", date: "2026-01-20", amount: 50, kind: "received", place: "Geburtstag", category: "Parents & family",
        paidFrom: null, coveredBy: ["r2"], left: 0 },
      { id: "r2", date: "2026-02-02", amount: -70, kind: "receipt", place: "Wochenmarkt", category: "Groceries",
        paidFrom: ["gift", "atm1"], coveredBy: null, left: null },
      { id: "atm2", date: "2026-02-15", amount: 60, kind: "withdrawal", place: "Bargeldauszahlung Geldautomat Fiktivbank", category: "Cash",
        paidFrom: null, coveredBy: ["m"], left: 50 },
      { id: "m", date: "2026-02-20", amount: -10, kind: "manual", place: "Flohmarkt", category: "Uncategorised",
        paidFrom: ["atm2"], coveredBy: null, left: null },
    ],
  });
  // `unaccounted` is what the withdrawals' category shows.
  assert.deepEqual([spentIn(dashboard, "2026-01", "Cash"), spentIn(dashboard, "2026-02", "Cash")], [50, 50]);
  assert.deepEqual(dashboard.cash, source.cash, "the dashboard passes the Cash page on");
  assert.deepEqual(dashboard.transactions.filter((t) => t.cashWithdrawal).map((t) => t.id), ["atm1", "atm2"]);
  // A view: the dashboard without it has the same numbers.
  const { cash, ...counted } = dashboard;
  assert.deepEqual(buildDashboard({ ...source, cash: undefined }), counted);
  assert.deepEqual([dashboard.total.expense, dashboard.total.income], [23.4 + 210 + 5, 1550]);
});

test("cash beyond the bank: a wrong direction, kind or paidFrom is refused by id; money received is cash only", () => {
  assert.throws(() => both([], [receipt("in", "2026-02-02", 5, "card", { direction: "in" })]), /^Error: Receipt in: money received is cash only/);
  assert.throws(() => both([], [receipt("odd", "2026-02-02", 5, "cash", { direction: "sideways" as "in" })]), /^Error: Receipt odd: /);
  assert.throws(() => both([], [receipt("kind", "2026-02-02", 5, "cash", { kind: "voucher" as "manual" })]), /^Error: Receipt kind: /);
  assert.throws(() => both([], [receipt("from", "2026-02-02", 5, "cash", { paidFrom: 7 as unknown as string })]), /^Error: Receipt from: /);
  // Left out or null: the defaults (out, receipt, automatic).
  const { source } = both([withdrawal("2026-02-01", -10, { id: "atm" })], [receipt("r", "2026-02-02", 5, "cash", { direction: null, kind: null, paidFrom: null })]);
  assert.deepEqual(tookFrom(source), { r: ["atm"] });
});

test("the category of the withdrawals is called Cash withdrawals / Abhebungen; its id, look and the shop list's rule stay", () => {
  const cash = DEFAULT_CATEGORIES.find((c) => c.id === "cash");
  assert.deepEqual(cash, { id: "cash", name: { en: "Cash withdrawals", de: "Abhebungen" }, group: "Money", kind: "spend" });
  assert.deepEqual(engine.categoryLook("cash"), { icon: "Banknote", color: "#6BCB77" });
  assert.equal(starterCategory({ counterparty: null, description: "Bargeldauszahlung Geldautomat Fiktivbank", amount: -50 }, DEFAULT_CATEGORIES), "cash");
});

const context = createContext({}); // No Node require/process/Buffer or web APIs injected.
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the bundle counts receipts and cash entries as the engine does", () => {
  const input = { categories, today: "2026-02-27", transactions: [withdrawal("2026-01-28", -100, { id: "atm" }), pay("2026-02-03", -23.4, { id: "bank" })],
    receipts: [receipt("a", "2026-01-30", 20, "cash"), receipt("b", "2026-02-02", 23.4, "card", { paymentId: "bank" }), receipt("c", "2026-02-04", 7, "card"),
      gift("g", "2026-02-05", 30), receipt("d", "2026-02-06", 40, "cash", { kind: "manual", paidFrom: "atm" })] };
  const direct = buildDashboardSource(input);
  assert.deepEqual(json(bundled.buildDashboardSource(input)), json(direct));
  assert.deepEqual(json(bundled.buildDashboard(bundled.buildDashboardSource(input))), json(buildDashboard(direct)));
});
