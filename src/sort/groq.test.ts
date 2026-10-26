import assert from "node:assert/strict";
import { test } from "node:test";
import { autoSort, type AutoPayment } from "./groq.js";
const payments = (count: number): AutoPayment[] => Array.from({ length: count }, (_, i) => ({ reference: `r${i}`, date: "2025-01-01", amount: -20, description: `MARKED_${i}`, counterparty: "Example" }));
const response = (results: unknown, usage: unknown = { prompt_tokens: 100, completion_tokens: 20 }) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results }) } }], usage }));

test("Groq batches at 25, uses selected model/JSON/temperature, whitelists fields, and reports usage", async () => {
  const sizes: number[] = [];
  const fake: typeof fetch = async (_, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "comparison-model"); assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(!body.messages[0].content.includes("Patrik"));
    const user = JSON.parse(body.messages[1].content);
    sizes.push(user.payments.length);
    assert.deepEqual(Object.keys(user.payments[0]).sort(), ["amount", "counterparty", "date", "description", "reference"]);
    return response(user.payments.map((p: AutoPayment) => ({ reference: p.reference, category: "Chosen" })));
  };
  const input = payments(51).map((p) => ({ ...p, trueCategory: "SECRET", databaseId: "SECRET" }));
  const result = await autoSort(["Chosen"], input, { apiKey: "fake", model: "comparison-model", fetch: fake });
  assert.deepEqual(sizes, [25, 25, 1]); assert.equal(result.results.length, 51);
  assert.ok(result.results.every((r) => r.category === "Chosen"));
  assert.ok(result.batches.every((b) => b.inputTokens === 100 && b.outputTokens === 20 && b.requests === 1 && b.seconds >= 0 && !b.error));
});
test("unknown names, missing answers, foreign references, duplicate answers and invalid rows are null", async () => {
  const result = await autoSort(["Known"], payments(6), { apiKey: "fake", fetch: async () => response([
    { reference: "r0", category: "Unknown" }, { reference: "r1", category: "known" },
    { reference: "foreign", category: "Known" }, null, 12,
    { reference: "r2", category: "Known" }, { reference: "r2", category: "Known" },
    { reference: "r3", category: null }, { reference: "r4", category: "Known" },
  ]) });
  assert.deepEqual(result.results.map((r) => r.category), [null, null, null, null, "Known", null]);
});
test("bounded 429 retries count requests and never expose error bodies", async () => {
  let requests = 0;
  const sleeps: number[] = [];
  const result = await autoSort(["Known"], payments(1), { apiKey: "fake", fetch: async () => {
    requests++;
    return new Response("MARKED_PROVIDER_ERROR", { status: 429, headers: { "retry-after": "2" } });
  }, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(requests, 3); assert.deepEqual(sleeps, [2000, 2000]);
  assert.equal(result.batches[0].error, "http");
  assert.equal(result.results[0].category, null);
  assert.ok(!JSON.stringify(result).includes("MARKED"));
});
test("network failures, malformed JSON, missing usage and malformed provider shapes stay private", async () => {
  for (const fake of [
    async () => { throw new Error("MARKED_NETWORK"); },
    async () => new Response("MARKED_BROKEN_JSON"),
    async () => new Response(JSON.stringify({ choices: [{ message: { content: "MARKED_BROKEN_CONTENT" } }] })),
    async () => new Response("null"),
  ]) {
    const result = await autoSort(["Known"], payments(1), { apiKey: "fake", fetch: fake });
    assert.equal(result.results[0].category, null); assert.ok(result.batches[0].error);
    assert.ok(!JSON.stringify(result).includes("MARKED"));
  }
  const result = await autoSort(["Known"], payments(1), { apiKey: "fake", fetch: async () => response([{ reference: "r0", category: "Known" }], {}) });
  assert.equal(result.batches[0].inputTokens, null); assert.equal(result.batches[0].outputTokens, null);
});
test("empty input does not call fetch, duplicate refs and missing key fail before a call", async () => {
  const fake: typeof fetch = async () => { throw new Error("must not call"); };
  assert.deepEqual(await autoSort(["Known"], [], { apiKey: "fake", fetch: fake }), { results: [], batches: [] });
  await assert.rejects(autoSort([], payments(1), { apiKey: "", fetch: fake }), /required/);
  await assert.rejects(autoSort([], [payments(1)[0], payments(1)[0]], { apiKey: "fake", fetch: fake }), /unique/);
});
