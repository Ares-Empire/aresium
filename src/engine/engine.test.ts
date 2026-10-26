import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine, buildTimingSource } from "../../scripts/build-engine.js";
import { buildDashboard } from "../data/dashboard.js";
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
test("bundled sample dashboard equals the direct server calculation", () => {
  const source = buildSampleSource();
  assert.deepEqual(json(bundled.buildDashboard(source)), json(buildDashboard(source)));
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
