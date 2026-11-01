import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine, buildTimingSource } from "../../scripts/build-engine.js";
import { buildDashboard, type Dashboard } from "../data/dashboard.js";
import { buildSampleSource } from "../data/sample-source.js";
import { parseVrBankCsv } from "../import/vrbank-csv.js";
import { parseCamt } from "../import/camt.js";
import { parsePaypalCsv } from "../import/paypal-csv.js";
import * as engine from "./index.js";

const context = createContext({}); // No Node require/process/Buffer or web APIs injected.
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

test("bundle exposes the engine API without Node globals", () => {
  assert.equal(runInContext("typeof require", context), "undefined");
  assert.equal(runInContext("typeof process", context), "undefined");
  assert.equal(runInContext("typeof Buffer", context), "undefined");
  assert.deepEqual(Object.keys(bundled).sort(), Object.keys(engine).sort());
  assert.equal(bundled.version, engine.version);
});
test("bundled sorting and learning run without Node or web APIs", () => {
  const payments = [{ counterparty: "REWE Filiale 123 Berlin" }, { counterparty: "REWE Filiale 456 München" }];
  const categories = [...engine.DEFAULT_CATEGORIES, { id: "custom" }];
  const learned = bundled.learn({}, payments[0], "custom");
  assert.equal(bundled.merchantKey(payments[0]), "rewe");
  assert.deepEqual(json(bundled.DEFAULT_CATEGORIES), json(engine.DEFAULT_CATEGORIES));
  assert.deepEqual(json(bundled.sortPayments(payments, { categories, learned })),
    engine.sortPayments(payments, { categories, learned }));
  assert.deepEqual(json(bundled.sortPayments(payments, { categories })),
    [{ categoryId: "groceries", source: "starter" }, { categoryId: "groceries", source: "starter" }]);
});
test("bundled shop identities and cross-shop learning equal the direct engine without host APIs", () => {
  const keys = ["MGP Vinted - Kleiderkreisel", "vinted uab", "dm-drogerie markt", "dm drogerie", "apple services",
    "apple.com bill", "muenchener rueckver", "muenchener rueckversic", "Max Mustermann", "Max Otto Mustermann", ""];
  assert.deepEqual(json(bundled.shopIdentities(keys)), engine.shopIdentities(keys));
  const payments = [{ counterparty: "Vinted, UAB", amount: -12 }, { counterparty: "Apple Services", amount: -8 }];
  const options = { categories: [{ id: "custom" }], learned: { "mgp vinted - kleiderkreisel": "custom", "apple store": "custom" } };
  assert.deepEqual(json(bundled.sortPayments(payments, options)), engine.sortPayments(payments, options));
  assert.ok(bundled.sortPayments(payments, options).every((result) => result.source === "learned"));
  assert.equal(bundled.merchantKey({ description: "FIKTIVSHOP          USA MUSTERSTADT            USD 7,43 Kurs: 1,086700 1,00% Auslandsums. 0,07Umsatz vom 09.10.2026 MC Hauptkarte" }), "fiktivshop");
});
test("bundled sample dashboard equals the direct server calculation", () => {
  const source = buildSampleSource();
  assert.deepEqual(json(bundled.buildDashboard(source)), json(buildDashboard(source)));
});

test("sample source JSON stays byte-identical; its dashboard counts the income tag on money out as spending", async () => {
  const source = buildSampleSource();
  assert.equal(createHash("sha256").update(JSON.stringify(source)).digest("hex"),
    "f79896e7c5135e670fd035f42357d109f775a3d46cdc215642a320622576bab0");
  const expected: Dashboard = JSON.parse(await readFile(new URL("../../web/public/app/dashboard.sample.json", import.meta.url), "utf8"));
  expected.pick.spend.push("Transfer");
  // Against the stored pre-68 sample: incoming payments leave spending lists, and the Fitness payment
  // tagged Income creates spending there. It no longer lowers Income's income row as brief 68 did.
  for (const t of expected.transactions) {
    if (t.amount > 0) t.categoriesIn = [];
    if (t.amount <= 0) t.incomeBuckets = [];
  }
  const tagged = expected.transactions.find((t) => t.amount < 0 && t.tags.includes("Income"))!;
  assert.equal(tagged.amount, -24.9);
  expected.total.categories.push({ name: "Income", total: 24.9 });
  expected.total.categories.sort((a, b) => b.total - a.total);
  expected.byMonth[tagged.month].categories.push({ name: "Income", total: 24.9 });
  expected.byMonth[tagged.month].categories.sort((a, b) => b.total - a.total);
  const index = source.months.findIndex((m) => m.key === tagged.month);
  expected.spend.Income.months[index] = 24.9;
  expected.spend.Income.days[tagged.month][tagged.day - 1] = 24.9;
  assert.deepEqual(buildDashboard(source), expected);
});
for (const [name, parser, bundledParser] of [
  ["vrbank.csv", parseVrBankCsv, bundled.parseVrBankCsv],
  ["camt.xml", parseCamt, bundled.parseCamt],
  ["paypal.csv", parsePaypalCsv, bundled.parsePaypalCsv],
] as const) {
  test(`bundled ${name} equals the server and stored Node answer, with ISO dates`, async () => {
    const file = new URL(`fixtures/${name}`, import.meta.url);
    const input = await readFile(file, "utf8");
    const expected = json(parser(input));
    assert.deepEqual(JSON.parse(await readFile(new URL(`${file.href}.expected.json`), "utf8")), expected);
    assert.deepEqual(json(bundledParser(input)), expected);
    assert.ok(bundledParser(input).transactions.every((txn) => typeof txn.bookingDate === "string"));
  });
}
test("timing source is deterministic and covers 24 months and 5,000 unique transactions", () => {
  const source = buildTimingSource();
  assert.deepEqual(source, buildTimingSource());
  assert.equal(source.transactions.length, 5000);
  assert.equal(new Set(source.transactions.map((txn) => txn.id)).size, 5000);
  assert.equal(new Set(source.transactions.map((txn) => txn.date.slice(0, 7))).size, 24);
  assert.deepEqual(json(bundled.buildDashboard(source)), json(buildDashboard(source)));
});
