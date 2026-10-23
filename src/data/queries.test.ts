import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { prisma } from "../lib/db.js";
import { buildDashboard } from "./dashboard.js";
import { getDashboardSource, getTransactionDetail } from "./queries.js";

// Prisma delegates expose methods through a proxy whose descriptors have no value.
// Replace the callable directly; node:test's mock.method cannot inspect these descriptors.
function replaceQuery<T extends object, K extends keyof T>(t: TestContext, target: T, key: K, implementation: unknown) {
  const original = target[key];
  target[key] = implementation as T[K];
  t.after(() => { target[key] = original; });
}

test("CAT_META uses own properties for dashboard categories and transaction details", async (t) => {
  const names = ["__proto__", "constructor", "toString", "Groceries"];
  const categories = names.map((name) => ({ name, color: "#123456", excludeFromTotals: false }));
  replaceQuery(t, prisma.category, "findMany", async () => categories);
  replaceQuery(t, prisma.transaction, "findMany", async () => []);
  const source = await getDashboardSource();
  let detailCategory = categories[0];
  replaceQuery(t, prisma.transaction, "findUnique", async () => ({
    id: "test-transaction", bookingDate: new Date("2026-01-01T00:00:00Z"),
    amount: 0, category: detailCategory, tags: [],
  }));
  for (const name of names) {
    const known = name === "Groceries";
    const category = source.categories.find((c) => c.name === name)!;
    assert.equal(category.icon, known ? "ShoppingCart" : "Tag");
    assert.equal(category.color, known ? "#26E07A" : "#123456");

    detailCategory = categories.find((c) => c.name === name)!;
    assert.equal((await getTransactionDetail("test-transaction"))?.categoryColor, category.color);
  }
});

test("source distinguishes a synthesised Uncategorised from a database category with that name", async (t) => {
  replaceQuery(t, prisma.transaction, "findMany", async () => [{
    id: "test-uncategorised", bookingDate: new Date("2026-01-01T00:00:00Z"), amount: -1,
    description: "Synthetic fixture", category: null, tags: [], balance: 0,
  }]);
  const categories: { name: string; color: string; excludeFromTotals: boolean }[] = [];
  replaceQuery(t, prisma.category, "findMany", async () => categories);
  const synthetic = await getDashboardSource();
  assert.deepEqual(synthetic.databaseCategoryNames, []);
  assert.equal(synthetic.categories.filter((c) => c.name === "Uncategorised").length, 1);
  assert.deepEqual(buildDashboard(synthetic).pick, { spend: [], income: [] });

  categories.push({ name: "Uncategorised", color: "#123456", excludeFromTotals: false });
  const real = await getDashboardSource();
  assert.deepEqual(real.databaseCategoryNames, ["Uncategorised"]);
  assert.ok(real.categories.some((c) => c.name === "Uncategorised"));
  assert.deepEqual(buildDashboard(real).pick, { spend: ["Uncategorised"], income: [] });
});
