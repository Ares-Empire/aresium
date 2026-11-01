import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse } from "csv-parse/sync";
import { csv, DEFAULT_SEED, encode, makeCases } from "./make.js";
import type { FileCase } from "./types.js";

test("CSV serialization preserves required quotes, multiline cells and delimiter characters", () => {
  const rows = [["a", "a;b", 'a"b', "a\nb", ""], ["ü", "ß", "€", "", ""]];
  for (const sep of [";", ",", "\t"]) for (const quoted of [false, true]) {
    assert.deepEqual(parse(csv(rows, sep, quoted, "\r\n"), { delimiter: sep }), rows);
  }
});

test("legacy encodings produce the intended bytes without replacing unrepresentable text", () => {
  assert.equal(encode("Äöß", "latin1").toString("hex"), "c4f6df");
  assert.equal(encode("€", "windows1252").toString("hex"), "80");
  assert.equal(encode("€", "latin15").toString("hex"), "a4");
  assert.equal(encode("€", "utf16le").toString("hex"), "fffeac20");
  assert.throws(() => encode("€", "latin1"), /cannot be represented/);
  assert.throws(() => encode("¤", "latin15"), /cannot be represented/);
});

test("the committed corpus has provenance, valid source hashes, required coverage and 30 constructed unknown banks", async () => {
  const folder = fileURLToPath(new URL("cases/", import.meta.url));
  const names = (await readdir(folder)).filter((n) => n.endsWith(".case.json"));
  assert.ok(names.length >= 150 && names.length <= 250);
  const cases = await Promise.all(names.map(async (n) => JSON.parse(await readFile(resolve(folder, n), "utf8")) as FileCase));
  assert.equal(cases.filter((c) => c.kind === "unknown-bank").length, 30);
  assert.ok(cases.filter((c) => c.provenance.method === "original").length >= 120);
  for (const c of cases) {
    assert.ok(c.situation && c.change);
    assert.equal(c.seed, DEFAULT_SEED);
    await readFile(resolve(folder, c.file));
    if (c.provenance.method === "original") {
      const original = await readFile(new URL(`../../src/engine/fixtures/banks/${c.provenance.reference}`, import.meta.url));
      assert.equal(createHash("sha256").update(original).digest("hex"), c.provenance.sha256);
      assert.ok(c.reimport && c.reimport.originalIds.length > 0);
    }
  }
  const kinds = new Set(cases.map((c) => c.kind));
  for (const kind of ["encoding-utf8", "encoding-utf8-bom", "encoding-windows1252", "encoding-latin1", "encoding-latin15", "encoding-utf16le",
    "separator-comma", "separator-semicolon", "separator-tab", "quotes-all", "quotes-minimal", "excel-short", "excel-iso", "excel-us",
    "preamble", "total-row", "empty-rows", "trailing-columns", "no-final-newline", "debit-credit", "s-h", "trailing-minus", "currency-in-cell",
    "multiline-text", "embedded-quote", "long-text", "account-sections", "broken-quote", "cutoff", "partial-with-warning"]) assert.ok(kinds.has(kind), kind);
  assert.ok(cases.some((c) => c.expected.outcome === "refuse"));
  // Deutsche Bank writes unpadded dates; spreadsheet rewrites must change those too.
  assert.match(await readFile(resolve(folder, "deutsche-bank--excel-iso.csv"), "utf8"), /2026-02-06/);
  assert.match(await readFile(resolve(folder, "deutsche-bank--excel-us.csv"), "utf8"), /02\/06\/2026/);
});

test("the same seed reproduces every committed byte and a different seed changes constructed payments", async () => {
  const root = fileURLToPath(new URL("out/", import.meta.url));
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(resolve(root, "make-test-"));
  try {
    await makeCases(folder);
    const committed = fileURLToPath(new URL("cases/", import.meta.url));
    const names = (await readdir(committed)).sort();
    assert.deepEqual((await readdir(folder)).sort(), names);
    for (const name of names) assert.deepEqual(await readFile(resolve(folder, name)), await readFile(resolve(committed, name)), name);
    const before = await readFile(resolve(folder, "unknown-01.case.json"));
    await makeCases(folder, 79);
    assert.notDeepEqual(await readFile(resolve(folder, "unknown-01.case.json")), before);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
