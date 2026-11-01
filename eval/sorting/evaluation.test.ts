import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { heldback, initialLabel, type EvalCase, type Answer } from "./model.js";
import { mergeAnswers, judgeMap, blindCases, merge, batches } from "./judge.js";
import { count, report, predict, loadSorter, record } from "./score.js";
import { parseExport, ownCounts, readOwnData, type LedgerExport } from "./own-data.js";
import { layouts, render } from "./render.js";
import { anonymise, cleanTags } from "./sources.js";
import { fromTags } from "./mapping.js";

function example(id = "abc", generator: Answer = { best: "groceries" }): EvalCase {
  return { id, kind: "madeup", payment: { amount: -19.37, counterparty: "Fiktiv Markt", description: "Kartenzahlung", source: "bank" }, generator,
    rendering: { layout: "ing", variation: "original", service: "direct", line: "Fiktiv Markt | Kartenzahlung" }, facts: { hidden: "SOURCE-SECRET" } };
}
test("merge accepts a category supported as best or alternative by two votes", () => {
  const c = example("abc", { best: "groceries", alsoRight: ["coffee-snacks"] });
  const l = mergeAnswers(c, [{ best: "coffee-snacks", alsoRight: ["groceries"] }, { best: "eating-out" }]);
  assert.deepEqual(l.accepted, ["coffee-snacks", "groceries"]); assert.equal(l.disputed, false); assert.equal(l.allThree, false);
});
test("duplicates in one vote never create a majority", () => {
  const c = example("abc", { best: "groceries", alsoRight: ["groceries", "groceries"] });
  assert.equal(mergeAnswers(c, [{ best: "clothes" }, { best: "health" }]).disputed, true);
});
test("unclear and personal combine into an unsorted majority while categories can also pass", () => {
  const l = mergeAnswers(example("abc", { personal: true, best: "friends" }), [{ unclear: true }, { best: "friends" }]);
  assert.equal(l.unsortedRight, true); assert.deepEqual(l.accepted, ["friends"]); assert.equal(l.disputed, false);
});
test("all-three shared outcome and exact sets are distinct", () => {
  const l = mergeAnswers(example(), [{ best: "groceries", alsoRight: ["coffee-snacks"] }, { best: "groceries" }]);
  assert.equal(l.allThree, true); assert.equal(l.exact, false);
  assert.equal(mergeAnswers(example(), [{ best: "groceries" }, { best: "groceries" }]).exact, true);
});
test("three-way disagreement is disputed and invalid IDs/empty answers fail", () => {
  assert.equal(mergeAnswers(example(), [{ best: "health" }, { best: "clothes" }]).disputed, true);
  assert.throws(() => mergeAnswers(example(), [{ best: "invalid" }, { unclear: true }]));
  assert.throws(() => mergeAnswers(example(), [{}, { unclear: true }]));
});
test("judge files must be complete with unique known IDs and allowed fields", () => {
  const c = example();
  assert.throws(() => judgeMap([], [c]));
  assert.throws(() => judgeMap([{ id: "wrong", unclear: true }], [c]));
  assert.throws(() => judgeMap([{ id: c.id, unclear: true }, { id: c.id, unclear: true }], [c]));
  assert.equal(judgeMap([{ id: c.id, personal: true }], [c]).size, 1);
});
test("held-back partition is stable, near 30%, and keeps twins/scenario sides together", () => {
  assert.equal(heldback("abc"), false); assert.equal(heldback("test-0"), true);
  const ids = Array.from({ length: 10000 }, (_, i) => `case-${i}`);
  const n = ids.filter(heldback).length; assert.ok(n > 2800 && n < 3200);
  assert.deepEqual(ids.map(heldback), [...ids].reverse().map(heldback).reverse());
  assert.equal(heldback("scenario.1"), heldback("scenario.2"));
  assert.equal(heldback("merchant"), heldback("merchant.twin"));
});
test("score partitions right, wrong, missed, unsorted-right and excludes disputed", () => {
  const label = initialLabel(example());
  const unclear = initialLabel(example("u", { unclear: true }));
  const personal = initialLabel(example("p", { best: "friends", personal: true }));
  assert.deepEqual(count([{ label, category: "groceries" }, { label, category: "clothes" }, { label, category: null },
    { label: unclear, category: null }, { label: unclear, category: "shopping" }, { label: personal, category: "friends" },
    { label: { ...label, disputed: true }, category: "groceries" }]), { total: 6, disputed: 1, sorted: 4, right: 2, wrong: 2, missed: 1, unsortedRight: 1 });
});
test("held-back reports contain no case IDs, lines or per-category rows", () => {
  const c = example("test-0"); c.rendering.line = "HELD-BACK-SECRET";
  const text = report([c], new Map([[c.id, initialLabel(c)]]), new Map([[c.id, "clothes"]])).text;
  assert.ok(!text.includes(c.id)); assert.ok(!text.includes(c.rendering.line)); assert.ok(!text.includes("category:groceries"));
  assert.ok(text.includes("Held back"));
});
test("blind cases strip kind, tags, generator, rendering and preserve scenario context", () => {
  const a = { ...example(), group: "secret-group" }, b = { ...example("def"), group: "secret-group" };
  const blind = blindCases([a, b]);
  assert.deepEqual(Object.keys(blind[0]).sort(), ["context", "id", "payment"]);
  assert.equal(blind[0].context?.length, 2);
  const text = JSON.stringify(blind); for (const secret of ["SOURCE-SECRET", "secret-group", "generator", "groceries", "madeup", "rendering"]) assert.ok(!text.includes(secret));
});
test("prediction uses one ordinary call and isolated scenario calls, with no learned rules", () => {
  const cases = [example(), example("def"), { ...example("group.1"), group: "group" }, { ...example("group.2"), group: "group" }];
  const calls: number[] = [];
  const predictions = predict(cases, (payments, options) => { calls.push(payments.length); assert.deepEqual(options.learned, {}); return payments.map(() => ({ categoryId: "groceries", source: "starter" })); });
  assert.deepEqual(calls, [2, 2]); assert.equal(predictions.size, 4);
});
test("each fixture CSV layout plus PayPal, CAMT and MT940 produces the intended sign and bank fields", async () => {
  const names = [...(await layouts()).map((l) => l.id), "paypal-de", "paypal-en", "camt053", "mt940"];
  for (const [i, layout] of names.entries()) for (const amount of [-37.29, 51.83]) {
    const { payment } = await render({ name: "Fiktiv Apotheke", purpose: "Rechnung", service: "direct", amount }, i, layout);
    assert.equal(payment.amount, amount, layout); assert.ok(payment.description, layout); assert.ok(payment.counterparty || payment.description.includes("Rechnung"), layout);
    assert.equal(payment.source, layout.startsWith("paypal") ? "paypal" : "bank", layout);
  }
});
test("rendering is repeatable and anonymisation preserves trades but replaces unknown tokens", async () => {
  assert.deepEqual(await render({ name: "Bäckerei Zelvorn", amount: -17.31 }, 2, "ing.csv"), await render({ name: "Bäckerei Zelvorn", amount: -17.31 }, 2, "ing.csv"));
  const result = anonymise("Friseur Petra Schmidt", "1", new Set());
  assert.ok(result.name.startsWith("Friseur ")); assert.ok(!result.name.includes("Petra")); assert.ok(!result.name.includes("Schmidt"));
  assert.equal(anonymise("Brand Example", "1", new Set(["brand example"])).name, "Brand Example");
  assert.deepEqual(cleanTags({ shop: "bakery", operator: "PRIVATE", phone: "PRIVATE" }), { shop: "bakery" });
});
test("independent mapping covers food, borderline and conflicting primary tags", () => {
  assert.deepEqual(fromTags({ shop: "bakery" }), { best: "groceries", alsoRight: ["coffee-snacks"] });
  assert.equal(fromTags({ shop: "kiosk" }).personal, true);
  assert.equal(fromTags({ shop: "unknown" }).unclear, true);
  assert.equal(fromTags({ amenity: "dentist", tourism: "hotel" }).unclear, true);
});
const fakeExport = (schema = 5): LedgerExport => ({ app: "Aresium", schema,
  accounts: [{ id: "a", iban: "DE36000000000000000001" }], categories: [{ id: "groceries" }, { id: "custom-PRIVATE-NAME" }],
  payments: [
    { id: "p1", account: "a", source: "bank", externalId: "FICT1", bookingDate: "2026-02-03", amount: "-1234.87", currency: "EUR", text: "PRIVATE-NAME shopping", counterparty: "PRIVATE-NAME", category: "groceries", categorySource: "manual", sequence: 1 },
    { id: "p2", account: "a", source: "bank", externalId: "FICT2", bookingDate: "2026-03-03", amount: "-6789.43", currency: "EUR", text: "PRIVATE-SECOND", category: "custom-PRIVATE-NAME", categorySource: "starter", sequence: 2 },
  ] });
test("own-data reads schema 1–5 and replay learns corrections chronologically", () => {
  for (let schema = 1; schema <= 5; schema++) {
    const data = fakeExport(schema); data.payments.push({ ...data.payments[0], id: "p3", externalId: "FICT3", bookingDate: "2026-04-03", sequence: 3 });
    const result = ownCounts(parseExport(data));
    assert.equal(result.manual.total, 2); assert.equal(result.kept.total, 1); assert.equal(result.replay.fixes, 2);
    assert.equal(result.replay.months[2].right, 1);
    const output = JSON.stringify(result); for (const s of ["PRIVATE", "1234.87", "6789.43", "2026-", "FICT"]) assert.ok(!output.includes(s));
  }
});
test("own-data fails closed for invalid exports, paths in repo and symlinks", async () => {
  assert.throws(() => parseExport({ ...fakeExport(), schema: 6 }));
  assert.throws(() => parseExport({ ...fakeExport(), payments: [{ ...fakeExport().payments[0], amount: "SECRET" }] }));
  const dir = await mkdtemp(join(tmpdir(), "ares-sorting-"));
  try {
    const repo = join(dir, "repo"); await mkdir(repo); const inside = join(repo, "export.json");
    await writeFile(inside, JSON.stringify(fakeExport())); const link = join(dir, "outside.json"); await symlink(inside, link);
    await assert.rejects(readOwnData(inside, repo)); await assert.rejects(readOwnData(link, repo));
    const dotdir = join(repo, "..private"); await mkdir(dotdir); const dotfile = join(dotdir, "fake.json");
    await writeFile(dotfile, JSON.stringify(fakeExport())); await assert.rejects(readOwnData(dotfile, repo));
    const outside = join(dir, "fake.json"); await writeFile(outside, JSON.stringify(fakeExport()));
    assert.equal((await readOwnData(outside, repo)).payments, 2);
    const cli = spawnSync(process.execPath, ["--import", "tsx", "eval/sorting/own-data.ts", outside], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    for (const secret of ["PRIVATE", "1234.87", "6789.43", "2026-02-03", "2026-03-03"]) assert.ok(!(cli.stdout + cli.stderr).includes(secret));
    await writeFile(outside, "PRIVATE-INVALID-1234.87");
    const bad = spawnSync(process.execPath, ["--import", "tsx", "eval/sorting/own-data.ts", outside], { encoding: "utf8" });
    assert.equal(bad.status, 1); assert.ok(!(bad.stdout + bad.stderr).includes("PRIVATE"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("record appends sorting metrics with header and preserves existing rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ares-history-")), file = pathToFileURL(join(dir, "history.csv"));
  try {
    const metrics = count([{ label: initialLabel(example()), category: "groceries" }]);
    await record(metrics, metrics, file); await record(metrics, metrics, file);
    const text = await readFile(file, "utf8"); assert.equal(text.trim().split("\n").length, 3); assert.equal(text.split(",sorting,").length, 3);
    assert.equal(text.trim().split("\n")[0].split(",").length, text.trim().split("\n")[1].split(",").length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("batch and file merge integration writes both label partitions, agreements and disputes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ares-judge-")), root = pathToFileURL(dir + "/");
  try {
    const cases = [example("abc"), example("test-0", { personal: true })];
    const judging = new URL("judging/", root); await batches(cases, judging);
    await writeFile(new URL("batch-99.jsonl", judging), "obsolete"); await batches(cases, judging);
    await assert.rejects(readFile(new URL("batch-99.jsonl", judging)));
    const first = join(dir, "first.jsonl"), second = join(dir, "second.jsonl");
    await writeFile(first, cases.map((c) => JSON.stringify({ id: c.id, best: c.id === "abc" ? "groceries" : null, personal: c.id !== "abc" })).join("\n"));
    await writeFile(second, cases.map((c) => JSON.stringify({ id: c.id, best: c.id === "abc" ? "health" : null, unclear: c.id !== "abc" })).join("\n"));
    await merge(cases, first, second, root);
    const worked = JSON.parse((await readFile(new URL("labels.jsonl", root), "utf8")).trim());
    const held = JSON.parse((await readFile(new URL("labels.heldback.jsonl", root), "utf8")).trim());
    assert.deepEqual(worked.accepted, ["groceries"]); assert.equal(held.unsortedRight, true);
    const agreement = JSON.parse(await readFile(new URL("agreement.json", root), "utf8"));
    assert.equal(agreement.madeup.total, 2); assert.equal(agreement.madeup.allThree, 1); assert.equal(agreement.madeup.twoOfThreeOnly, 1);
    const changed = [{ ...cases[0], generator: { best: "health" } }, cases[1]];
    await assert.rejects(merge(changed, first, second, root), /changed/);
    await writeFile(first, JSON.stringify({ id: "abc", best: "clothes" }) + "\n" + JSON.stringify({ id: "test-0", personal: true }));
    await merge(cases, first, second, root);
    assert.equal(JSON.parse((await readFile(new URL("disputed.jsonl", root), "utf8")).trim()).label.disputed, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("a scenario is wrong as a group when any side is wrong and missed when any clear side is missing", () => {
  const a = { ...example("abc.1"), group: "abc", kind: "scenario" as const }, b = { ...example("abc.2"), group: "abc", kind: "scenario" as const };
  const labels = new Map([a, b].map((c) => [c.id, initialLabel(c)]));
  assert.ok(report([a, b], labels, new Map([[a.id, "groceries"], [b.id, "health"]])).text.includes('"wrong":1'));
  assert.ok(report([a, b], labels, new Map([[a.id, "groceries"], [b.id, null]])).text.includes('"missed":1'));
});
test("different two-voter coalitions may accept several categories without a three-way intersection", () => {
  const l = mergeAnswers(example("abc", { best: "groceries", alsoRight: ["coffee-snacks"] }),
    [{ best: "groceries", alsoRight: ["eating-out"] }, { best: "coffee-snacks", alsoRight: ["eating-out"] }]);
  assert.deepEqual(l.accepted, ["coffee-snacks", "eating-out", "groceries"]); assert.equal(l.allThree, false);
});
test("engine exceptions cannot print held-back payment contents", () => {
  assert.throws(() => predict([example("test-0")], () => { throw new Error("SECRET-HELD-PAYMENT"); }),
    (error: unknown) => error instanceof Error && !error.message.includes("SECRET") && error.message.includes("withheld"));
});
test("bundled engine loader reads the AresiumEngine global without Node globals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ares-bundle-"));
  try {
    const file = join(dir, "engine.js");
    await writeFile(file, 'if (typeof process !== "undefined" || typeof require !== "undefined") throw new Error("Node global"); var AresiumEngine = { sortPayments: function(payments) { return payments.map(function() { return {categoryId: "groceries", source: "starter"}; }); } };');
    const sorter = await loadSorter(file);
    assert.equal(sorter([example().payment], { categories: [{ id: "groceries" }] })[0].categoryId, "groceries");
    await writeFile(file, "var wrongGlobal = {};"); await assert.rejects(loadSorter(file), /expose/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("record preserves another evaluator's columns and quoted CSV values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ares-history-shared-")), file = pathToFileURL(join(dir, "history.csv"));
  try {
    await writeFile(file, 'date,commit,suite,files_result\n2026-01-01,abc,files,"quoted, count"\n');
    const metrics = count([]); await record(metrics, metrics, file);
    const { splitCsv } = await import("../../src/engine/readers/csv.js");
    const rows = splitCsv(await readFile(file, "utf8"), ",");
    assert.equal(rows[1][3], "quoted, count"); assert.equal(rows[2][2], "sorting"); assert.equal(rows[2][3], "");
    assert.equal(rows[0].length, rows[1].length); assert.equal(rows[0].length, rows[2].length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("unlabelled originals appear in confusion counts but never supply replay corrections", () => {
  const data = fakeExport(); data.payments = [{ ...data.payments[0], category: null, categorySource: "none" }];
  const result = ownCounts(parseExport(data));
  assert.equal(result.unlabelled, 1); assert.equal(result.manual.total + result.kept.total, 0);
  assert.equal(result.confusion[0].chosen, "unsorted"); assert.equal(result.confusion[0].count, 1); assert.equal(result.replay.fixes, 0);
});
test("PayPal exports keep the seller name rather than a bank terminal descriptor", async () => {
  const row = await render({ name: "Bäckerei Fiktiv", amount: -13.29, service: "SUMUP *" }, 0, "paypal-de");
  assert.equal(row.payment.counterparty, "Bäckerei Fiktiv"); assert.equal(row.payment.description, "Bäckerei Fiktiv");
  assert.equal(row.rendering.service, "PayPal export");
});
