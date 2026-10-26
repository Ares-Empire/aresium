import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sha1 } from "./sha1.js";
import { parseVrBankCsv } from "./vrbank-csv.js";
import { parseCamt } from "./camt.js";

const nodeHash = (text: string) => createHash("sha1").update(text).digest("hex");
for (const [name, text] of [
  ["empty", ""], ["ASCII", "abc"], ["umlauts", "Äpfel, Öl, Grüße, Straße"],
  ["emoji", "🦊🥨🚀"], ["unpaired surrogates", "\ud800x\udfff"],
  ["long", "Grüße 🥨 abc".repeat(100000)],
  ...[55, 56, 63, 64, 65, 119, 120, 127, 128].map((n) => [`padding-${n}`, "a".repeat(n)]),
]) {
  test(`SHA-1 matches Node UTF-8: ${name}`, () => assert.equal(sha1(text), nodeHash(text)));
}
for (const [name, parser] of [["vrbank.csv", parseVrBankCsv], ["camt.xml", parseCamt]] as const) {
  test(`${name} keeps the original Node-crypto transaction ids`, async () => {
    const text = await readFile(new URL(`../engine/fixtures/${name}`, import.meta.url), "utf8");
    const { transactions } = parser(text);
    assert.equal(transactions.length, 2);
    for (const txn of transactions) {
      if (txn.externalId === "FICTIONAL-CAMT-2") continue; // explicit CAMT reference wins
      const original = nodeHash(`${txn.bookingDate.toISOString()}|${txn.amount}|${txn.description}|${txn.counterparty ?? ""}`).slice(0, 24);
      assert.equal(txn.externalId, original);
    }
    if (name === "camt.xml") assert.equal(transactions[1].externalId, "FICTIONAL-CAMT-2");
  });
}
