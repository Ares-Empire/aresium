import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
const context = createContext({
  window: {}
});
runInContext(
  await readFile(new URL("../../web/public/app/search.js", import.meta.url), "utf8"),
  context);
const search = context.window.AresiumSearch.search as (q: string, g: Record<string, object>) => any[];
const group = (key: string, name: string, names = [name], count = 1) => ({
  key,
  name,
  names,
  count,
  newestDate: "2026-01-01",
  moneyOut: 10,
  moneyIn: 0
});
test(
  "name search ranks exact, full prefix, word prefixes, substrings, then a one-letter miss",
  () => {
    const groups = Object.fromEntries(
      [
        group("exact", "Fictional"),
        group("prefix", "Fictional Bakery"),
        group("words", "The Fictional Bakery"),
        group("inside", "Nonfictional Shop"),
        group("miss", "Fictionel")
      ].map((g) => [g.key, g]));
    assert.deepEqual(
      Array.from(search("fictional", groups), (g) => g.key),
      ["exact", "prefix", "words", "inside", "miss"]);
  });
test(
  "search finds hidden bank/own names, folds accents and ß and caps at fifty",
  () => {
    const g = group("hidden", "Fictional Café", ["Fictional Café", "Fiktive Straße"]);
    assert.equal(search("STRASSE", {
      hidden: g
    })[0].matchedName, "Fiktive Straße");
    assert.equal(search("cafe fictional", {
      hidden: g
    })[0].key, "hidden");
    assert.equal(search(" ", {
      hidden: g
    }).length, 0);
    assert.equal(
      search(
        "Fictional",
        Object.fromEntries(
          Array.from(
            {
              length: 80
            },
            (_, i) => [String(i), group(String(i), "Fictional " + i)]))).length,
      50);
  });
