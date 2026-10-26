import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { checkSourceParity, compare, report } from "../../scripts/check-source-parity.js";
import { dashboardSourceFromRows, getDashboardSource, getDashboardSourceLegacy, type SourceRows } from "./queries.js";

// Prisma's proxy methods need assignment rather than mock.method (see queries.test.ts).
function replaceQuery<T extends object, K extends keyof T>(t: TestContext, target: T, key: K, implementation: unknown) {
  const original = target[key];
  target[key] = implementation as T[K];
  t.after(() => { target[key] = original; });
}

// A made-up database in the shape Prisma returns: Decimal amounts and balances, Date booking dates, the export's
// original row as JSON, category and tag relations, ordered by booking date with same-day ties. Fictional shops,
// ids and amounts only. Covers what the source step does: PayPal funding rows, currency conversions (one without a
// euro row), refunds, payments without a category, tags, bank balances with gaps, a category not in CAT_META and
// one named like an Object prototype key.
function madeUpDatabase({ withUncategorisedCategory = false } = {}): SourceRows {
  let seed = 20261027;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const euros = (cents: number) => new Prisma.Decimal((cents / 100).toFixed(2));

  const category = (name: string, excludeFromTotals = false, color = "#64748b") =>
    ({ id: `cat-${name}`, name, color, icon: null, excludeFromTotals });
  const categories = [
    category("Groceries"), category("Rent"), category("Income"), category("Transfer", true), category("Tax"),
    category("Clothes"), category("Modellbau", false, "#123456"), category("constructor"),
    ...(withUncategorisedCategory ? [category("Uncategorised")] : []),
  ];
  const byName = new Map(categories.map((c) => [c.name, c]));
  const shops = ["Märchenbäckerei", "Fiktivmarkt", "Beispiel Buchladen", "Erfundenes Café", "Musterkleidung"];

  type Row = Record<string, unknown> & { bookingDate: Date };
  const rows: Row[] = [];
  let bank = 150_000; // cents
  let n = 0;
  const row = (date: Date, source: "bank" | "paypal", cents: number, fields: {
    description: string; counterparty?: string | null; category?: string | null; tags?: string[];
    currency?: string; raw?: Record<string, string>; balance?: boolean; city?: string | null;
  }) => {
    n++;
    if (source === "bank") bank += cents;
    const cat = fields.category === undefined ? null : fields.category === null ? null : byName.get(fields.category)!;
    rows.push({
      id: `row-${n}`, accountId: source === "bank" ? "account-bank" : "account-paypal", source,
      externalId: `${source}-${n}`, bookingDate: date, valueDate: null, amount: euros(cents),
      balance: source === "bank" && fields.balance !== false ? euros(bank) : null, currency: fields.currency ?? "EUR",
      description: fields.description, counterparty: fields.counterparty ?? null, categoryId: cat?.id ?? null,
      category: cat, tags: (fields.tags ?? []).map((name) => ({ category: byName.get(name)! })),
      city: fields.city ?? null, raw: fields.raw ?? { Verwendungszweck: fields.description },
    });
  };

  for (let i = 0; i < 420; i++) { // 2025-09-01 to 2026-10-24
    const day = new Date(Date.UTC(2025, 8, 1 + i));
    const at = (hours: number) => new Date(day.getTime() + hours * 3_600_000);
    if (day.getUTCDate() === 1) row(day, "bank", 123_456, { description: "Gehalt Fiktiv GmbH", counterparty: "Fiktiv GmbH", category: "Income" });
    if (day.getUTCDate() === 3) row(day, "bank", -65_000, { description: "Miete", counterparty: "Hausverwaltung Beispiel", category: "Rent", tags: ["Tax"] });
    for (let k = Math.floor(random() * 3); k > 0; k--) {
      const shop = pick(shops);
      row(day, "bank", -Math.round(200 + random() * 8_000), {
        description: `Kartenzahlung ${shop}`, counterparty: shop, city: pick(["Beispielstadt", null]),
        category: pick(["Groceries", "Groceries", "Modellbau", "constructor", null]),
        tags: random() < 0.1 ? ["Clothes"] : [], balance: random() > 0.05,
      });
    }
    if (random() < 0.08) row(day, "bank", Math.round(500 + random() * 3_000), { description: "Erstattung", counterparty: pick(shops), category: "Groceries" });
    if (random() < 0.1) {
      // A PayPal purchase paid from the bank: the purchase, PayPal's funding row and the bank's PayPal line.
      const cents = Math.round(500 + random() * 6_000);
      row(at(10), "paypal", -cents, { description: "Musterkleidung", counterparty: "Musterkleidung", category: "Clothes", raw: { Typ: "Allgemeine Zahlung" } });
      row(at(10), "paypal", cents, { description: "Bankgutschrift auf PayPal-Konto", category: "Transfer", raw: { Typ: "Bankgutschrift auf PayPal-Konto" } });
      row(at(12), "bank", -cents, { description: "PP.4711.PP . Ihr Einkauf bei Musterkleidung", counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A", category: "Transfer" });
    }
    if (random() < 0.04) {
      // A purchase in dollars and its two conversions; every fourth has no euro row (reported, kept as it is).
      const code = `paypal-usd-${n + 1}`, usd = Math.round(1_000 + random() * 9_000);
      row(at(15), "paypal", -usd, { description: "Example Tools Inc", counterparty: "Example Tools Inc", category: "Modellbau", currency: "USD", raw: { Typ: "PayPal Express-Zahlung" } });
      rows[rows.length - 1].externalId = code;
      row(at(15), "paypal", usd, { description: "Allgemeine Währungsumrechnung", currency: "USD", raw: { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": code } });
      if (random() > 0.25) row(at(15), "paypal", -Math.round(usd * 0.92), { description: "Allgemeine Währungsumrechnung", raw: { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": code } });
    }
  }
  // Ordered by booking date, as fetchWithCategory asks the database; a stable sort keeps same-time ties in place.
  rows.sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime());
  return { transactions: rows as unknown as SourceRows["transactions"], categories: categories as unknown as SourceRows["categories"] };
}

function useDatabase(t: TestContext, db: SourceRows) {
  replaceQuery(t, prisma.transaction, "findMany", async () => db.transactions);
  replaceQuery(t, prisma.category, "findMany", async () => db.categories);
}

const moments = ["2026-10-27T09:30:00Z", "2026-03-15T23:59:59Z", "2027-01-01T00:00:00Z", "2025-09-01T00:00:00Z"].map((m) => new Date(m));

test("the parity check finds the engine identical to the legacy body on a made-up database", async (t) => {
  for (const withUncategorisedCategory of [false, true]) {
    const db = madeUpDatabase({ withUncategorisedCategory });
    useDatabase(t, db);
    for (const now of moments) {
      assert.equal(await checkSourceParity(now), `identical (${db.transactions.length} payments compared)`);
    }
  }
});

test("the made-up database exercises every step of the source", () => {
  const db = madeUpDatabase();
  const { source, unmatched } = dashboardSourceFromRows(db, moments[0]);
  const legacy = getDashboardSourceLegacy(db, moments[0]);
  assert.ok(db.transactions.length > 500);
  assert.ok(unmatched.length > 0, "a dollar purchase without a euro row");
  assert.deepEqual(unmatched, legacy.unmatched);
  assert.ok(source.transactions.length < db.transactions.length, "funding and conversion rows left out");
  assert.ok(source.transactions.some((txn) => txn.categoryName === "Uncategorised"));
  assert.ok(source.transactions.some((txn) => txn.tags.length > 0));
  assert.deepEqual(source.months.filter((m) => m.partial).map((m) => [m.key, m.days]), [["2026-10", 27]]);
  assert.equal(source.months.length, 14);
  assert.deepEqual(source.categories.find((c) => c.name === "Modellbau"), { name: "Modellbau", icon: "Tag", color: "#123456", kind: "spend" });
  assert.equal(source.categories.find((c) => c.name === "Income")?.kind, "income");
  assert.equal(source.categories.find((c) => c.name === "Transfer")?.kind, "transfer");
  assert.equal(source.openingBalance, 2734.56); // the first bank balance: the salary on top of 1,500
});

test("getDashboardSource serves the engine's source and warns with the legacy body's PayPal codes", async (t) => {
  const db = madeUpDatabase();
  useDatabase(t, db);
  const warnings: string[] = [];
  t.mock.method(console, "warn", (line: string) => { warnings.push(line); });
  t.mock.timers.enable({ apis: ["Date"], now: moments[0] });
  const served = await getDashboardSource();
  const legacy = getDashboardSourceLegacy(db, moments[0]);
  assert.deepEqual(served, legacy.source);
  assert.deepEqual(warnings, [`PayPal: no euro conversion found for ${legacy.unmatched.length} foreign-currency payment(s): ${legacy.unmatched.join(", ")}`]);
});

test("the check counts differing keys per part and never prints a value", () => {
  const a = { source: { transactions: [{ amount: -12.34, place: "Märchenbäckerei" }], months: [] }, unmatched: ["paypal-usd-1"] };
  const b = { source: { transactions: [{ amount: -12.35, place: "Märchenbäckerei" }], months: {}, extra: undefined }, unmatched: [] };
  const result = compare(a, b);
  assert.deepEqual(result.parts, { "source.transactions": 1, "source.months": 1, "source.extra": 1, unmatched: 2 });
  const line = report(result, 1);
  assert.equal(line, "5 differing keys (source.transactions: 1, source.months: 1, unmatched: 2, source.extra: 1)");
  for (const value of ["12.3", "Märchen", "paypal-usd"]) assert.ok(!line.includes(value), value);
  assert.equal(report(compare({ x: 1, y: 2 }, { y: 2, x: 1 }), 1), "same values, different key order");
  assert.equal(report(compare({ x: [0] }, { x: [-0] }), 1), "1 differing keys (x: 1)");
  assert.equal(report(compare(a, structuredClone(a)), 7), "identical (7 payments compared)");
});
