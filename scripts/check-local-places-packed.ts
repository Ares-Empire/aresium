// Exhaustive public-list parity. No private data and no examples in output.
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { findLocalPlace, indexLocalPlaces, type LocalPlacesData } from "../src/engine/sorting/local-places.js";

for (const variant of ["de", "left-out"]) {
  const json = JSON.parse(gunzipSync(await readFile(new URL(`../data/local-places/${variant}.json.gz`, import.meta.url))).toString("utf8")) as LocalPlacesData;
  const packed = indexLocalPlaces(gunzipSync(await readFile(new URL(`../data/local-places/${variant}.places.bin.gz`, import.meta.url))));
  let names = 0, townPairs = 0, payments = 0;
  const check = (counterparty: string, description = "") => {
    const pay = { counterparty, description, amount: -12, source: "bank" as const };
    assert.deepEqual(findLocalPlace(pay, packed), findLocalPlace(pay, json), "JSON/packed lookup differs (details withheld)");
    payments++;
  };
  const start = performance.now();
  for (const [name, , towns] of json.rows) {
    check(name); names++;
    for (let i = 0; i < towns.length; i += 2) {
      const town = json.towns[towns[i]];
      check(`${name} ${town} DE`);
      check(name, `${name} ${town} DE`);
      check(`${name}   DEU ${town}   EUR 12,00 Umsatz vom 01.01.2026`);
      townPairs++;
    }
  }
  console.log(JSON.stringify({ variant, names, townPairs, payments, differences: 0, seconds: (performance.now() - start) / 1000 }));
}
