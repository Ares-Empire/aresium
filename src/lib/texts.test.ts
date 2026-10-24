import assert from "node:assert/strict";
import { test } from "node:test";
import { requestLanguage } from "./texts.js";

test("Accept-Language chooses the highest-quality English or German tag, first on ties", () => {
  const cases: [string | string[] | undefined, string][] = [
    [undefined, "en"], [[], "en"], [["de", "en"], "en"], ["", "en"], ["fr", "en"],
    ["de", "de"], ["de-DE", "de"], ["de-DE,de;q=0.9,en;q=0.8", "de"],
    ["en", "en"], ["en-GB,de;q=0.5", "en"], ["en;q=0.4,de;q=0.9", "de"],
    ["de;q=0.4,en;q=0.9", "en"], ["fr;q=1,de;q=0.2,en;q=0.1", "de"],
    ["de;q=0.8,en;q=0.8", "de"], ["en;q=0.8,de;q=0.8", "en"],
    [" DE-de ; Q=0.900 , en;q=0.100 ", "de"], ["de;q=0,en;q=0", "en"],
    ["de;q=0,en;q=0.1", "en"], ["*", "en"], ["unreadable", "en"],
    ["de;q=nope", "en"], ["de;q=2", "en"], ["de;q=-1", "en"],
    ["de;q=0.1234", "en"], ["de;q=NaN", "en"], ["de;q=0.9;q=1", "en"],
    ["de;broken,en", "en"], ["deutsch", "en"], ["fr-DE", "en"],
    ["de;q=0.1,en;q=bad", "de"], ["en;q=0,de;q=0.001", "de"],
  ];
  for (const [header, language] of cases) assert.equal(requestLanguage(header), language, String(header));
});
