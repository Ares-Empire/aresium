import test from "node:test";
import assert from "node:assert/strict";
import { anonymise } from "./sources.js";
import names from "./person-names.json" with { type: "json" };

const change = (name: string) => anonymise(name, "fictional-place", new Set()).name;
test("personal first and surnames inside a business are replaced by names of the same kind", () => {
  const result = change("Friseur Petra Schmidt");
  const [trade, first, last] = result.split(" ");
  assert.equal(trade, "Friseur");
  assert.ok(names.replacementFirstNames.includes(first));
  assert.ok(names.replacementSurnames.includes(last));
  assert.ok(!result.includes("Petra")); assert.ok(!result.includes("Schmidt"));
});
test("business names, foreign words, places and their punctuation survive byte for byte", () => {
  for (const name of ["Pizzeria Bella Napoli", "Trattoria Sakura", "Taverna Olympia", "Tantris",
    "Pho Lotus", "Da Napoli", "Chez Nous", "Zum Goldenen Hirsch", "Zur Post", "Der Fischer",
    "Der Koch", "Hotel am Müllerplatz", "Café in der Thomas-Mann-Straße", "Bistro an der Schillerstraße",
    "Nordlicht Handels GmbH", "Café Möbel Design"]) assert.equal(change(name), name);
});
test("titles and explicit owner markers identify names outside the vocabulary", () => {
  for (const prefix of ["Dr.", "Dr. med.", "Prof. Dr. med. dent.", "Inh.", "Inhaber", "Inhaberin", "Frau", "Herr"]) {
    const original = prefix + " Fikta Zelvorn";
    const result = change(original);
    assert.ok(result.startsWith(prefix + " "));
    assert.ok(!result.includes("Fikta")); assert.ok(!result.includes("Zelvorn"));
    assert.ok(names.replacementFirstNames.includes(result.slice(prefix.length + 1).split(" ")[0]));
    assert.ok(names.replacementSurnames.includes(result.split(" ").at(-1)!));
  }
});
test("personal names following conversational owner markers are replaced", () => {
  for (const name of ["Pizzeria Da Lorenzo", "Bistro Chez Antoine", "Cafe bei Petra", "Zum Toni", "Zur Anna"]) {
    const result = change(name);
    assert.notEqual(result, name);
    assert.equal(result.split(" ").slice(0, -1).join(" "), name.split(" ").slice(0, -1).join(" "));
  }
});
test("possessives preserve their punctuation while replacing the personal name", () => {
  for (const name of ["Toni's Pizzeria", "Toni’s Pizzeria", "Schumann's Bar", "Schumann’s Bar", "Tonis Pizzeria", "Schumanns Bar"]) {
    const result = change(name);
    assert.notEqual(result, name);
    assert.equal(result.replace(/^[\p{L}\p{M}]+/u, ""), name.replace(/^[\p{L}\p{M}]+/u, ""));
  }
});
test("word-like surnames need personal ownership context", () => {
  for (const name of ["Müller", "Becker", "Fischer", "Koch", "Schneider"]) {
    assert.notEqual(change("Bäckerei " + name), "Bäckerei " + name);
    assert.notEqual(change("Friseur Petra " + name), "Friseur Petra " + name);
    assert.notEqual(change(name), name);
    assert.notEqual(change(name + "'s Laden"), name + "'s Laden");
  }
  assert.equal(change("Zum Fischer am See"), "Zum Fischer am See");
  assert.equal(change("Der Schneider"), "Der Schneider");
  assert.equal(change("Die schöne Rose"), "Die schöne Rose");
});
test("multilingual common personal names are recognised without changing business wording", () => {
  for (const [first, last] of [["Ayşe", "Demir"], ["Giulia", "Bellini"], ["Eleni", "Papadopoulos"],
    ["Katarzyna", "Kowalska"], ["Linh", "Nguyễn"], ["Amira", "Haddad"]]) {
    const result = change("Restaurant " + first + " " + last);
    assert.ok(result.startsWith("Restaurant "));
    assert.ok(!result.includes(first)); assert.ok(!result.includes(last));
  }
});
test("replacement is seeded, preserves case, and cannot retain any original personal-name word", () => {
  const source = "FRISEUR PETRA SCHMIDT";
  assert.equal(change(source), change(source));
  assert.equal(change(source), change(source).toUpperCase());
  const name = "Friseur Maren Lindenbrück";
  const result = change(name);
  assert.ok(!result.includes("Maren")); assert.ok(!result.includes("Lindenbrück"));
  assert.notEqual(change("Praxis Petra Schmidt-Meyer"), "Praxis Petra Schmidt-Meyer");
  assert.ok(!change("Praxis Petra Schmidt-Meyer").includes("Meyer"));
});
test("exact NSI brands override the person-name rules", () => {
  const name = "Bäckerei Fischer";
  assert.equal(anonymise(name, "1", new Set(["bäckerei fischer"])).name, name);
  assert.equal(anonymise("Brand Example", "1", new Set(["brand example"])).name, "Brand Example");
});
test("hint-word measure counts trade and cuisine wording without relying on brand names or source tags", async () => {
  const { hintWordShare } = await import("./name-hints.js");
  assert.deepEqual(hintWordShare(["Pizzeria Bella Napoli", "Trattoria Sakura", "Pho Lotus", "Taverna Olympia",
    "Schumann's Bar", "Tantris", "Nordlicht"]), { total: 7, withHint: 5, share: 5 / 7 });
});
test("owner surnames following retail trade words and initials following a title are replaced", () => {
  for (const business of ["Schuhhaus", "Autohaus", "Blumenhaus", "Juwelier", "Reisebüro"]) {
    assert.notEqual(change(business + " Fischer"), business + " Fischer");
  }
  const result = change("Dr. med. P. Schmidt");
  assert.match(result, /^Dr\. med\. [A-Z]\. [\p{L}]+$/u);
  assert.ok(!result.includes("P.")); assert.ok(!result.includes("Schmidt"));
});
test("food wording after a personal name is not mistaken for a rare surname", () => {
  const result = change("Mariam Food");
  assert.ok(result.endsWith(" Food"));
  assert.ok(!result.includes("Mariam"));
  const vietnamese = change("Restaurant An Nguyễn");
  assert.ok(!vietnamese.includes(" An ")); assert.ok(!vietnamese.includes("Nguyễn"));
});
test("owner markers recognise rare personal names while ordinary foreign phrases remain literal", () => {
  for (const marker of ["Da", "Chez", "bei"]) {
    const result = change("Bistro " + marker + " Fikta Zelvorn");
    assert.ok(!result.includes("Fikta")); assert.ok(!result.includes("Zelvorn"));
    assert.ok(result.startsWith("Bistro " + marker + " "));
  }
  for (const name of ["Chez Nous", "Da Napoli", "Da Nang", "Da Quattro", "Chez Sakura"]) assert.equal(change(name), name);
});
test("unknown foreign/business words after a first name are not automatically surnames", () => {
  const result = change("Adrian Suites");
  assert.ok(result.endsWith(" Suites")); assert.ok(!result.includes("Adrian"));
  assert.equal(change("Huong Lua"), "Huong Lua");
  assert.equal(change("Maren-Lindenbrück Kantine"), "Maren-Lindenbrück Kantine");
  assert.equal(change("Max und Moritz"), "Max und Moritz");
  assert.notEqual(change("Friseur Germaine"), "Friseur Germaine");
  assert.notEqual(change("Autowerkstatt Miller"), "Autowerkstatt Miller");
});
