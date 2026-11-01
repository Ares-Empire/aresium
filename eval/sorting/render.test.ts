import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DELIVERY_SERVICES, SERVICES, chooseService, render, serviceAllowed } from "./render.js";
import { blindCases, rerenderedBatch } from "./judge.js";
import { loadCases, readLines, type Answer, type EvalCase } from "./model.js";

test("delivery apps wrap only meals, snacks, and the permitted grocery/pharmacy cases", () => {
  const examples: { answer: Answer; pharmacy?: boolean; allowed: string[] }[] = [
    { answer: { best: "eating-out" }, allowed: [...DELIVERY_SERVICES] },
    { answer: { best: "coffee-snacks" }, allowed: [...DELIVERY_SERVICES] },
    { answer: { best: "groceries", alsoRight: ["coffee-snacks"] }, allowed: [...DELIVERY_SERVICES] },
    { answer: { best: "groceries" }, allowed: ["Wolt", "Uber Eats"] },
    { answer: { best: "health" }, pharmacy: true, allowed: ["Wolt", "Uber Eats"] },
    { answer: { best: "health" }, pharmacy: false, allowed: [] },
    { answer: { best: "personal-care" }, allowed: [] },
    { answer: { best: "entertainment" }, allowed: [] },
    { answer: { best: "utilities" }, allowed: [] },
    { answer: { best: "insurance" }, allowed: [] },
    { answer: { best: "clothes" }, allowed: [] },
    { answer: { best: "car-fuel" }, allowed: [] },
    { answer: { best: "going-out" }, pharmacy: true, allowed: [] },
    { answer: { unclear: true }, allowed: [] },
  ];
  for (const example of examples) for (const service of DELIVERY_SERVICES) {
    assert.equal(serviceAllowed(service, example), example.allowed.includes(service));
  }
});
test("valid seeded choices stay unchanged, invalid delivery choices deterministically use the remaining services", () => {
  const meal = { name: "Fiktiv Pizzeria", amount: -17.39, answer: { best: "eating-out" } };
  const doctor = { name: "Fiktiv Arztpraxis", amount: -17.39, answer: { best: "health" }, pharmacy: false };
  const fallbacks = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const original = SERVICES[i % SERVICES.length];
    assert.equal(chooseService(meal, i), original);
    const chosen = chooseService(doctor, i);
    assert.equal(chosen, chooseService(doctor, i));
    if (DELIVERY_SERVICES.includes(original)) {
      assert.ok(!DELIVERY_SERVICES.includes(chosen));
      fallbacks.add(chosen);
    } else assert.equal(chosen, original);
  }
  assert.equal(fallbacks.size, SERVICES.length - DELIVERY_SERVICES.length);
  assert.equal(chooseService({ ...doctor, service: "Wolt" }, 3, true), "PayPal export");
});
test("rendered payment text uses the replacement processor, never a delivery prefix for a doctor", async () => {
  for (const service of DELIVERY_SERVICES) {
    const input = { name: "Fiktiv Arztpraxis", amount: -17.39, answer: { best: "health" }, service };
    const result = await render(input, 12, "ing.csv");
    assert.ok(!DELIVERY_SERVICES.includes(result.rendering.service));
    assert.ok(![result.payment.counterparty, result.payment.description].some((text) => text?.includes(service)));
  }
});
test("no corpus delivery wrapper has an incompatible first answer, and health delivery means a pharmacy", async () => {
  const cases = await loadCases();
  let invalid = 0;
  for (const c of cases) {
    if (!DELIVERY_SERVICES.includes(c.rendering.service)) continue;
    const tags = c.facts.tags as Record<string, string> | undefined;
    const pharmacy = tags?.amenity === "pharmacy" || (c.kind === "madeup" && (c.facts.subtype === "descriptive")
      && [c.payment.counterparty, c.payment.description].some((text) => /apotheke/i.test(text ?? "")));
    if (!serviceAllowed(c.rendering.service, { answer: c.generator, pharmacy })) invalid++;
  }
  // Only aggregate counts in failures: never disclose held-back payment lines or IDs.
  assert.equal(invalid, 0);
});
test("selective rejudging lists only changed payments and uses the full-batch blind fields and context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ares-rerender-"));
  const root = pathToFileURL(directory + "/");
  const original: EvalCase = { id: "fake.1", kind: "scenario", group: "fake", generator: { best: "groceries" },
    payment: { amount: -17.39, source: "bank", counterparty: "Fiktiv Markt" },
    rendering: { layout: "ing", variation: "original", service: "direct", line: "Fiktiv Markt" },
    facts: { source: "made up" } };
  const partner = { ...original, id: "fake.2", payment: { ...original.payment, amount: 17.39 } };
  const metadataOnly = { ...original, id: "metadata", group: undefined, generator: { best: "clothes" } };
  const changed = { ...original, payment: { ...original.payment, counterparty: "SUMUP *Fiktiv Markt" } };
  try {
    const before = [original, partner, { ...metadataOnly, generator: { best: "groceries" } }];
    const after = [changed, partner, metadataOnly];
    assert.deepEqual(await rerenderedBatch(before, after, root), ["fake.1"]);
    assert.equal(await readFile(new URL("rerendered-ids.txt", root), "utf8"), "fake.1\n");
    const lines = await readLines(new URL("batch-12-rerendered.jsonl", root));
    assert.deepEqual(lines, blindCases(after).filter((row) => row.id === "fake.1"));
    assert.deepEqual(Object.keys(lines[0] as object).sort(), ["context", "id", "payment"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
