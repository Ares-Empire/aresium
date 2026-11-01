import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { createContext, Script } from "node:vm";
import { packLocalPlaces } from "../../scripts/local-places-pack.js";
import { bundleEngine } from "../../scripts/build-engine.js";
import { findLocalPlace, indexLocalPlaces, setLocalPlaces, type LocalPlacesData } from "./sorting/local-places.js";
import { PackedLocalPlaces, placesChecksum } from "./sorting/local-places-packed.js";
import { DEFAULT_CATEGORIES, sortPayments } from "./index.js";

const data: LocalPlacesData = {
  version: 1, attribution: "© fictional test", source: "fictional", dataDate: "2026-01-01",
  categories: ["eating-out", "clothes", "hobbies"], towns: ["", "quarzhausen", "funkendorf", "moerlen", "morlen", "garching"],
  rows: [["quarzfunken", 0, [1, 0, 2, 1]], ["quarzfunken atelier", 2, []],
    ["quarzkristall", -1, [3, 0, 4, 1]], ["zur quarzmuehle", -1, [1, 0, 2, 1, 5, 2]]],
};
const payment = (counterparty: string, description = "", amount = -12) => ({ counterparty, description, amount, source: "bank" as const });
const decode = (bytes: Uint8Array, offsets: Uint32Array, i: number) => Buffer.from(bytes.subarray(offsets[i], offsets[i + 1])).toString("utf8");

function roundTrip(json: LocalPlacesData, bytes: Uint8Array): void {
  const packed = new PackedLocalPlaces(bytes);
  assert.equal(packed.dataDate, json.dataDate); assert.equal(packed.source, json.source); assert.equal(packed.attribution, json.attribution);
  assert.equal(packed.header[4], json.rows.length);
  assert.deepEqual(Array.from({ length: packed.header[5] }, (_, i) => packed.town(i)), json.towns);
  assert.deepEqual(Array.from({ length: packed.header[6] }, (_, i) => packed.category(i)), json.categories);
  for (const [name, category, towns] of json.rows) {
    const row = packed.rowFor(name);
    assert.ok(row >= 0);
    assert.equal(decode(packed.names, packed.nameOffsets, row), name);
    assert.equal(packed.nationalCategories[row], category === -1 ? 0xffff : category);
    const pairs: number[] = [];
    for (let i = packed.matchOffsets[row]; i < packed.matchOffsets[row + 1]; i++) pairs.push(packed.matchTowns[i], packed.matchCategories[i]);
    assert.deepEqual(pairs, towns);
  }
}

test("packed local places round trip metadata, every column, and empty tables", () => {
  roundTrip(data, packLocalPlaces(data));
  roundTrip({ ...data, categories: [], towns: [], rows: [] }, packLocalPlaces({ ...data, categories: [], towns: [], rows: [] }));
  assert.deepEqual(packLocalPlaces(data), packLocalPlaces(data));
});

test("packed lookup preserves towns, ambiguity, national overrides, and safeguards", () => {
  const bytes = packLocalPlaces(data), index = indexLocalPlaces(bytes);
  for (const pay of [payment("Quarzfunken"), payment("Quarzfunken Funkendorf DE"), payment("Zur Quarzmühle"),
    payment("Zur Quarzmühle", "ZUR QUARZMUEHLE QUARZHAUSEN DE"), payment("SUMUP *Quarzfunken"),
    payment("Quarzkristall MORLEN DE"), payment("Zur Quarzmühle GARCHIN DE"), payment("Zur Quarzmühle GARCHIN"),
    payment("Quarzfunken   GBR London   EUR 12,00 Umsatz vom 01.01.2026"),
    payment("Zur Quarzmühle   DEU Funkendorf   EUR 12,00 Umsatz vom 01.01.2026"),
    payment("Quarzfunken", "", 12), payment("Quarzfunk"), payment("Quarzfunken extra"), payment("EREF:Quarzfunken"),
    payment("Quarzfunken Atelier"), payment("Quarzfunken Atelier Quarzhausen DE")]) {
    assert.deepEqual(findLocalPlace(pay, index), findLocalPlace(pay, data), pay.counterparty);
    assert.deepEqual(sortPayments([pay], { categories: DEFAULT_CATEGORIES, localPlaces: bytes.buffer as ArrayBuffer }),
      sortPayments([pay], { categories: DEFAULT_CATEGORIES, localPlaces: data }));
  }
});

test("packed search uses UTF-8 byte order, including non-BMP names and missing prefixes", () => {
  const names = ["abcdefgh", "abcdefgh ijkl", "éclairquarz", "\u{10000}quarzfunken", "\ue000quarzfunken", "東京quarzfunken"];
  const json = { ...data, rows: names.sort().map((name) => [name, 0, []] as const) };
  const index = new PackedLocalPlaces(packLocalPlaces(json));
  for (const name of names) assert.ok(index.rowFor(name) >= 0, name);
  for (const name of ["", "abcdefg", "abcdefgh i", "éclair", "\u{10001}quarzfunken", "zzz"]) assert.equal(index.rowFor(name), -1, name);
  roundTrip(json, packLocalPlaces(json));
});

test("packed views share the original block and accept aligned Uint8Array slices", () => {
  const raw = packLocalPlaces(data), padded = new Uint8Array(raw.length + 12);
  padded.set(raw, 4);
  const slice = padded.subarray(4, raw.length + 4), index = indexLocalPlaces(slice) as PackedLocalPlaces;
  assert.equal(indexLocalPlaces(slice), index);
  for (const value of Object.values(index)) { assert.ok(ArrayBuffer.isView(value)); assert.equal(value.buffer, padded.buffer); }
  assert.deepEqual(findLocalPlace(payment("Quarzfunken"), slice), findLocalPlace(payment("Quarzfunken"), data));
  assert.throws(() => indexLocalPlaces(padded.subarray(1, 1 + raw.length)), /aligned/);
});

test("packed reader refuses corrupt headers, data, offsets, codes, ordering, and UTF-8", () => {
  const raw = packLocalPlaces(data);
  const corrupt = (change: (bytes: Uint8Array, h: Uint32Array) => void, reason: RegExp, checksum = true) => {
    const bytes = raw.slice(), h = new Uint32Array(bytes.buffer, 0, 32);
    change(bytes, h);
    if (checksum) h[22] = placesChecksum(bytes);
    assert.throws(() => new PackedLocalPlaces(bytes), reason);
  };
  assert.throws(() => new PackedLocalPlaces(raw.subarray(0, 10)), /truncated header/);
  assert.throws(() => new PackedLocalPlaces(raw.subarray(0, raw.length - 1)), /file length/);
  corrupt((_, h) => h[0] = 0, /magic/);
  corrupt((_, h) => h[1] = 999, /unsupported version 999/);
  corrupt((bytes) => bytes[bytes.length - 5] ^= 1, /checksum/, false);
  corrupt((_, h) => h[9] += 4, /section bounds/);
  corrupt((_, h) => h[4] = 0xffffffff, /section bounds/);
  corrupt((bytes, h) => new Uint32Array(bytes.buffer, h[9], h[4] + 1)[1] = 0xffffffff, /string range/);
  corrupt((bytes, h) => new Uint16Array(bytes.buffer, h[11], h[4])[0] = 1000, /national category/);
  corrupt((bytes, h) => new Uint32Array(bytes.buffer, h[13], h[7])[0] = h[5], /town\/category/);
  corrupt((bytes, h) => bytes[h[10]] = 0xff, /UTF-8/);
  corrupt((bytes, h) => bytes[h[10]] = 0x7a, /name ordering/);
});

test("installed places stay opt in, can be replaced, and can be released", () => {
  const pay = payment("Quarzfunken"), options = { categories: DEFAULT_CATEGORIES, localPlaces: true };
  setLocalPlaces(null);
  assert.equal(sortPayments([pay], options)[0].categoryId, null);
  setLocalPlaces(packLocalPlaces(data));
  assert.equal(sortPayments([pay], { categories: DEFAULT_CATEGORIES })[0].categoryId, null);
  assert.equal(sortPayments([pay], { ...options, localPlaces: false })[0].categoryId, null);
  assert.equal(sortPayments([pay], options)[0].categoryId, "eating-out");
  assert.throws(() => setLocalPlaces(new ArrayBuffer(4)), /truncated/);
  assert.equal(sortPayments([pay], options)[0].categoryId, "eating-out");
  setLocalPlaces(packLocalPlaces({ ...data, rows: [["quarzfunken", 1, []]] }));
  assert.equal(sortPayments([pay], options)[0].categoryId, "clothes");
  setLocalPlaces(null);
  assert.equal(sortPayments([pay], options)[0].categoryId, null);
});

test("bundled engine accepts foreign-realm buffers without browser codecs; installed lists belong to their context", async () => {
  const code = new Script(await bundleEngine()), a = createContext({}), b = createContext({});
  code.runInContext(a); code.runInContext(b);
  a.bytes = packLocalPlaces(data); a.payments = [payment("Quarzfunken")]; a.categories = DEFAULT_CATEGORIES;
  new Script("AresiumEngine.setLocalPlaces(bytes.buffer); result = AresiumEngine.sortPayments(payments, {categories, localPlaces: true})").runInContext(a);
  assert.equal(a.result[0].categoryId, "eating-out");
  b.payments = a.payments; b.categories = DEFAULT_CATEGORIES;
  new Script("result = AresiumEngine.sortPayments(payments, {categories, localPlaces: true})").runInContext(b);
  assert.equal(b.result[0].categoryId, null);
  new Script("AresiumEngine.setLocalPlaces(null)").runInContext(a);
});

for (const variant of ["de", "left-out"]) test(`packed ${variant} asset preserves every name, category and town pair`, () => {
  const json = JSON.parse(gunzipSync(readFileSync(new URL(`../../data/local-places/${variant}.json.gz`, import.meta.url))).toString("utf8")) as LocalPlacesData;
  const packed = gunzipSync(readFileSync(new URL(`../../data/local-places/${variant}.places.bin.gz`, import.meta.url)));
  roundTrip(json, packed);
  assert.deepEqual(packed, Buffer.from(packLocalPlaces(json)));
});
