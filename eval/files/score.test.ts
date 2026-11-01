import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { BankFile, BankTxn, CsvLayout } from "../../src/engine/readers/types.js";
import { comparePayments, formatReport, HISTORY_HEADER, loadReader, recordHistory, runCases, scoreCase, summarize } from "./score.js";
import { cents, type FileCase, type Payment } from "./types.js";

const row: Payment = { date: "2026-10-14", amountCents: -123456, currency: "EUR", counterparty: "Fiktiv Laden", text: "Fiktiver Einkauf" };
const txn = (overrides: Partial<BankTxn> = {}): BankTxn => ({ bookingDate: "2026-10-14T00:00:00.000Z", amount: "-1234.56",
  currency: "EUR", counterparty: "Fiktiv Laden", description: "Fiktiver Einkauf", externalId: "original-1", raw: {}, ...overrides });
const file = (transactions = [txn()]): BankFile => ({ format: "csv", transactions });
const spec = (overrides: Partial<FileCase> = {}): FileCase => ({ version: 1, file: "test.csv", seed: 78, bank: "fictional", kind: "test",
  situation: "A made-up test file.", change: "test", provenance: { method: "construction", reason: "Written before the mock reader." },
  expected: { outcome: "read", payments: [row] }, ...overrides });
const refused = spec({ expected: { outcome: "refuse", code: "noTable", reason: "Not a bank table." } });
const bytes = new Uint8Array();
const result = (s = spec(), f = file()) => scoreCase(s, bytes, () => f);

test("a correct payment is one right file and zero wrong rows", () => {
  const counts = summarize([result()]);
  assert.equal(counts.readRight, 1);
  assert.equal(counts.readWrong, 0);
  assert.equal(counts.silentlyWrongRows, 0);
});

test("coded refusals distinguish expected, unexpected, wrong-code and uncoded errors", () => {
  const throws = (s: FileCase, code?: string) => scoreCase(s, bytes, () => { throw Object.assign(new Error("refused"), { code }); });
  const counts = summarize([throws(refused, "noTable"), throws(spec(), "noTable"), throws(refused, "unknown"), throws(refused)]);
  assert.equal(counts.refusedExpected, 1);
  assert.equal(counts.refusedUnexpected, 3);
  assert.equal(counts.silentlyWrongRows, 0);
});

test("a row with several wrong fields counts once, with all differences named", () => {
  const r = result(spec(), file([txn({ amount: "1234.56", currency: "USD", bookingDate: "2026-10-15T00:00:00.000Z", counterparty: "Fiktiv Andere" })]));
  assert.equal(r.status, "wrong");
  assert.equal(r.wrongRows, 1);
  assert.deepEqual(r.differences[0].fields, ["date", "amountCents", "currency", "counterparty"]);
  assert.equal(summarize([r]).silentlyWrongRows, 1);
});

test("each critical field, purpose text and sub-cent precision is checked", () => {
  for (const override of [{ amount: "1234.56" }, { amount: "-1234.567" }, { currency: "USD" },
    { bookingDate: "2026-01-14T00:00:00.000Z" }, { counterparty: "Fiktiv Andere" }, { description: "Wrong purpose" }]) {
    assert.equal(result(spec(), file([txn(override)])).wrongRows, 1);
  }
  assert.equal(cents("-0.01"), -1);
  assert.equal(cents("1234.5600"), 123456);
  assert.equal(cents("1.001"), null);
  assert.equal(cents("1e2"), null);
});

test("a missing row is counted without shifting later rows", () => {
  const s = spec({ expected: { outcome: "read", payments: [row, { ...row, text: "Second" }, { ...row, text: "Third" }] } });
  const r = result(s, file([txn({ description: "Second" }), txn({ description: "Third" })]));
  assert.equal(r.wrongRows, 1);
  assert.deepEqual(r.differences[0].fields, ["missing payment"]);
});

test("extra rows and duplicate occurrences are counted separately", () => {
  assert.equal(result(spec(), file([txn(), txn()])).wrongRows, 1);
  assert.equal(result(spec({ expected: { outcome: "read", payments: [row, row] } })).wrongRows, 1);
  assert.equal(result(spec({ expected: { outcome: "read", payments: [row, row, row] } })).wrongRows, 2);
  assert.deepEqual(comparePayments([row, { ...row, text: "Second" }], [{ ...row, text: "Second" }, row]), []);
});

test("a changed id is measured separately from correct payment fields", () => {
  const r = result(spec({ reimport: { originalIds: ["original-1"] } }), file([txn({ externalId: "changed-1" })]));
  const c = summarize([r]);
  assert.equal(c.readRight, 1);
  assert.equal(c.silentlyWrongRows, 0);
  assert.equal(c.reimportKept, 0);
  assert.equal(c.reimportTotal, 1);
  assert.deepEqual(r.reimport, { kept: false, matched: 0, total: 1 });
  assert.match(formatReport([r]), /Re-import ids kept: 0\/1/);
});

test("id multiplicity, successful re-imports and refused re-imports retain their denominators", () => {
  const s = spec({ reimport: { originalIds: ["original-1", "original-1"] }, expected: { outcome: "read", payments: [row, row] } });
  assert.equal(result(s, file([txn(), txn()])).reimport?.kept, true);
  assert.equal(result(s, file([txn()])).reimport?.kept, false);
  const refusedRead = scoreCase(s, bytes, () => { throw Object.assign(new Error("empty"), { code: "empty" }); });
  assert.deepEqual(refusedRead.reimport, { kept: false, matched: 0, total: 2 });
  const c = summarize([result(s, file([txn(), txn()])), refusedRead]);
  assert.equal(c.reimportKept, 1);
  assert.equal(c.reimportTotal, 2);
  assert.equal(c.idsKept, 2);
  assert.equal(c.idsTotal, 4);
});

test("re-import identity follows each payment through reordering and detects swapped ids", () => {
  const s = spec({ reimport: { originalIds: ["original-1", "original-2"] }, expected: { outcome: "read", payments: [row, { ...row, text: "Second" }] } });
  assert.equal(result(s, file([txn({ externalId: "original-2", description: "Second" }), txn()])).reimport?.kept, true);
  const swapped = result(s, file([txn({ externalId: "original-2" }), txn({ externalId: "original-1", description: "Second" })]));
  assert.equal(swapped.reimport?.kept, false);
  assert.equal(swapped.reimport?.matched, 2);
});

test("a file that should be refused is wrong even when it returns no payments", () => {
  assert.equal(result(refused, file([])).status, "wrong");
  assert.equal(result(refused, file([])).wrongRows, 0);
  const r = result(refused);
  assert.equal(r.wrongRows, 1);
  assert.equal(summarize([r]).silentlyWrongRows, 1);
});

const layout: CsvLayout = { version: 1, separator: ";", header: ["Date", "Amount"], dateFormat: "YYYY-MM-DD", numberFormat: "en", columns: { date: 0, amount: 1 } };
test("unknown banks use only the unchanged first guess; wrong rows remain behind the review gate", () => {
  let calls = 0;
  const r = scoreCase(spec(), bytes, (_, saved) => {
    calls++;
    if (!saved) return { ...file([]), needsLayout: { layout, confidence: 1, unsure: [], missing: [], separator: ";", header: layout.header, headerRow: 0, columns: [], preview: [] } };
    assert.strictEqual(saved[0], layout);
    return file([txn({ amount: "1234.56" })]);
  });
  assert.equal(calls, 2);
  assert.equal(r.status, "wrong");
  const c = summarize([r]);
  assert.equal(c.silentlyWrongRows, 0);
  assert.equal(c.reviewWrongRows, 1);
  assert.equal(c.wrongRowsWithoutError, 1);
  assert.equal(c.reviewFiles, 1);
});

test("an incomplete guess is a safe stop, never a coded expected refusal or a silent row error", () => {
  const r = scoreCase(refused, bytes, () => ({ ...file([]), needsLayout: { layout: null, confidence: 0, unsure: [], missing: ["amount"], separator: ";", header: [], headerRow: 0, columns: [], preview: [] } }));
  assert.equal(r.review, true);
  assert.equal(r.status, "refusedUnexpected");
  assert.equal(r.wrongRows, 0);
});

test("partial reading requires the stated skipped-row warning", () => {
  const s = spec({ expected: { outcome: "read", payments: [row], warning: { skipped: 1, reason: "One unreadable row." } } });
  assert.equal(result(s, { ...file(), skipped: 1 }).status, "right");
  const r = result(s, file());
  assert.equal(r.status, "wrong");
  assert.equal(r.wrongRows, 0);
  assert.match(r.problems[0], /warning/);
});

async function temporary<T>(fn: (path: string) => Promise<T>) {
  const root = fileURLToPath(new URL("out/", import.meta.url));
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(resolve(root, "score-test-"));
  try { return await fn(path); } finally { await rm(path, { recursive: true, force: true }); }
}

test("history is one suite-neutral CSV row per recording and preserves other suites", async () => temporary(async (folder) => {
  const path = resolve(folder, "history.csv");
  const sorting = '"2026-10-31","abc","sorting","{""right"":7}"\n';
  await writeFile(path, HISTORY_HEADER + sorting);
  const c = summarize([result(), result(refused, file([]))]);
  await recordHistory(path, "def-dirty", c, "2026-11-01T00:00:00.000Z");
  const content = await readFile(path, "utf8");
  assert.ok(content.startsWith(HISTORY_HEADER + sorting));
  const rows = parseHistory(content);
  assert.equal(rows.length, 3);
  assert.equal(rows[2][2], "files");
  assert.deepEqual(JSON.parse(rows[2][3]), c);
  const fresh = resolve(folder, "new.csv");
  await recordHistory(fresh, "def", c);
  assert.ok((await readFile(fresh, "utf8")).startsWith(HISTORY_HEADER));
}));

// Use the existing independent CSV package to verify escaping, not the score's own CSV string builder.
import { parse as parseHistory } from "csv-parse/sync";
test("history refuses an incompatible header without overwriting it", async () => temporary(async (folder) => {
  const path = resolve(folder, "history.csv");
  await writeFile(path, "different,header\n");
  await assert.rejects(recordHistory(path, "def", summarize([])), /Unexpected history format/);
  assert.equal(await readFile(path, "utf8"), "different,header\n");
}));

test("bundle loader executes the supplied bundle and validates its public entry point", async () => temporary(async (folder) => {
  const path = resolve(folder, "engine.js");
  await writeFile(path, 'var AresiumEngine = { readBankFile: function(bytes) { return { format: "csv", transactions: [], skipped: bytes[0] }; } };');
  assert.equal((await loadReader(path))([7]).skipped, 7);
  await writeFile(path, "var AresiumEngine = {};");
  await assert.rejects(loadReader(path), /readBankFile/);
}));

test("missing inputs and malformed manifests fail the harness rather than earn a refusal score", async () => temporary(async (folder) => {
  await assert.rejects(runCases(folder, () => file()), /No file cases/);
  await writeFile(resolve(folder, "bad.case.json"), JSON.stringify(spec({ file: "../escape.csv" })));
  await assert.rejects(runCases(folder, () => file()), /Invalid case manifest/);
  await writeFile(resolve(folder, "bad.case.json"), JSON.stringify(spec()));
  await assert.rejects(runCases(folder, () => file()), /ENOENT/);
}));
