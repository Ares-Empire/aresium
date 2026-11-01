import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fromTags, answer } from "./mapping.js";
import { ROOT, hash, heldback, writeLines, readLines, initialLabel, type Label, type EvalCase, type Answer } from "./model.js";
import { NSI, nsiBrands, osmPlaces, cleanTags, anonymise } from "./sources.js";
import { render, opaqueId, SERVICES, IBANS, layouts, type RenderInput } from "./render.js";

const random = (seed: string) => parseInt(hash(seed).slice(0, 8), 16) / 2 ** 32;
const ordered = <T>(items: T[], key: (item: T) => string) => [...items].sort((a, b) => random(key(a)) - random(key(b)));
const nameKey = (s: string) => s.normalize("NFC").toLowerCase().trim();
// Only membership facts are read; no engine category IDs or rules inform an answer.
async function knownNames(): Promise<Set<string>> {
  const list = JSON.parse(await readFile(new URL("../../src/engine/sorting/shops.de.json", import.meta.url), "utf8")) as Record<string, [unknown, string[]][] >;
  return new Set([...(list.brands ?? []), ...(list.merchants ?? []), ...(list.rules ?? [])].flatMap(([, names]) => names.map(nameKey)));
}
const inventedSurnames = ["Zelvorn", "Pevrath", "Lumkeld", "Tavrix", "Nolwem", "Kivdorn", "Rilvex", "Vunfeld", "Daxlorn", "Wemkiv"];
const inventedFirstNames = ["Zelina", "Pevilo", "Lumira", "Tavino", "Nolira", "Kivana", "Riluno", "Vunela", "Daxira", "Wemino"];
const person = (i: number) => `${inventedFirstNames[i % 10]} ${inventedSurnames[Math.floor(i / 10) % 10]}`;

// Explicit service descriptions are independently authored. Neither this list nor NSI answers consult the engine.
const services: [string, string, Answer][] = [
  ["Netflix", "Streaming Abo", answer("subscriptions", "entertainment")],
  ["Disney+", "Streaming Abo", answer("subscriptions", "entertainment")],
  ["Spotify", "Musik Abo", answer("subscriptions", "entertainment")],
  ["Deezer", "Musik Abo", answer("subscriptions", "entertainment")],
  ["Apple iCloud", "Cloud Speicher Abo", answer("subscriptions", "electronics")],
  ["Microsoft 365", "Software Abo", answer("subscriptions", "work")],
  ["Hetzner", "Hosting beruflich", answer("work", "subscriptions")],
  ["Proton", "Mail Abo", answer("subscriptions", "internet-phone")],
  ["Telekom", "Internet Festnetz", answer("internet-phone")],
  ["Vodafone", "Mobilfunkvertrag", answer("internet-phone")],
  ["congstar", "Handy Prepaid", answer("internet-phone")],
  ["freenet", "Mobilfunkvertrag", answer("internet-phone")],
  ["E.ON", "Abschlag Strom", answer("utilities")], ["Vattenfall", "Abschlag Gas", answer("utilities")],
  ["Allianz", "Haftpflichtversicherung", answer("insurance")], ["HUK24", "KFZ Versicherung", answer("insurance")],
  ["Deutsche Bahn", "Deutschlandticket", answer("bus-train", "travel")], ["FlixBus", "Fahrkarte", answer("bus-train", "travel")],
  ["Lufthansa", "Flugticket", answer("travel")], ["Bolt", "Taxifahrt", answer("taxi-sharing")],
  ["Free Now", "Taxifahrt", answer("taxi-sharing")], ["Miles", "Carsharing Miete", answer("taxi-sharing", "travel")],
  ["Lieferando", "Essensbestellung", answer("eating-out")], ["Wolt", "Essensbestellung", answer("eating-out")],
  ["Uber Eats", "Essensbestellung", answer("eating-out")], ["Amazon", "Bestellung", { ...answer("shopping"), personal: true }],
  ["eBay", "Bestellung", { ...answer("shopping"), personal: true }], ["Temu", "Bestellung", { ...answer("shopping"), personal: true }],
  ["Kleinanzeigen", "Kauf", { personal: true }], ["PayPal", "", { unclear: true }],
];

type Nonshop = RenderInput & { label: Answer; topic: string };
function nonshop(i: number): Nonshop {
  const who = person(i), employer = `Fiktiv ${inventedSurnames[i % 10]} Werke GmbH`;
  const rows: [string, string, Answer, boolean?][] = [
    [employer, "Gehalt Lohn Monat", answer("salary"), true], [employer, "Nebenjob Honorar", answer("salary"), true],
    ["Fiktiv Studierendenwerk", "BAfoeG Ausbildungsfoerderung", answer("bafoeg-scholarships"), true],
    ["Fiktiv Foerderstiftung", "Stipendium", answer("bafoeg-scholarships"), true],
    ["Familienkasse", "Kindergeld", answer("kindergeld"), true],
    [who, "Miete Wohnung", answer("rent")], ["Fiktiv Wohnen GmbH", "Warmmiete Wohnung", answer("rent")],
    ["Fiktiv Stadtwerke", "Abschlag Strom Gas", answer("utilities")], ["Fiktiv Energie GmbH", "Wasser Abwasser Abschlag", answer("utilities")],
    ["Fiktiv Netze GmbH", "Internet Festnetz", answer("internet-phone")], ["Fiktiv Mobil GmbH", "Mobilfunk Rechnung", answer("internet-phone")],
    ["Fiktiv Schutz AG", "Haftpflichtversicherung Beitrag", answer("insurance")],
    ["Finanzamt Musterstadt", "Einkommensteuer Vorauszahlung", answer("taxes")],
    ["Fiktiv Stadtkasse", "Grundsteuer", answer("taxes")], ["ARD ZDF Deutschlandradio", "Rundfunkbeitrag", answer("fees", "subscriptions")],
    ["Fiktivbank", "Kontofuehrung Entgelt", answer("fees")], ["Fiktivbank", "Kartenentgelt Jahresgebuehr", answer("fees")],
    ["Fiktivbank", "Zinsgutschrift", answer("interest-dividends"), true],
    ["Fiktiv Depot", "Dividende Ausschuettung", answer("interest-dividends"), true],
    ["Geldautomat Fiktivbank", "Bargeldauszahlung ATM", answer("cash")],
    ["Fiktiv Hilfswerk", "Spende", answer("donations")],
    ["Fiktiv Kulturverein eV", "Mitgliedsbeitrag", answer("memberships")],
    ["ADAC", "Mitgliedsbeitrag", answer("memberships", "car-fuel")],
    ["Fiktiv Sportverein eV", "Mitgliedsbeitrag Sport", answer("sports-fitness", "memberships")],
    ["Fiktiv Universitaet", "Semesterbeitrag", answer("education", "fees")],
    ["Zalando", "Erstattung Retoure Kleidung", { ...answer("clothes", "other-income"), personal: true }, true],
    ["Fiktiv Buchhandlung", "Rueckzahlung Buchkauf", { ...answer("hobbies", "other-income", "education"), personal: true }, true],
    ["Vinted", "Auszahlung Verkauf", answer("selling-things"), true],
    ["Kleinanzeigen", "Verkaufserloes", answer("selling-things"), true], ["eBay", "Auszahlung Verkauf", answer("selling-things"), true],
    [who, "", { personal: true }, true], [who, "", { personal: true }],
    [who, "Anteil gemeinsames Abendessen", { ...answer("friends", "eating-out"), personal: true }],
    [who, "Unterstuetzung von Eltern", answer("parents-family"), true],
    [who, "Geburtstagsgeschenk", answer("gifts", "friends")],
    ["PayPal", "", { unclear: true }],
    [who, "Mieteinnahme Wohnung", answer("other-income"), true],
    ["Fiktiv Depot", "Wertpapierkauf Sparplan", answer("savings-investing")],
    ["Finanzamt Musterstadt", "Steuererstattung", { ...answer("taxes", "other-income"), personal: true }, true],
    ["Fiktiv Krankenversicherung", "Kostenerstattung Behandlung", { ...answer("health", "other-income"), personal: true }, true],
    ["Fiktivbank", "Bareinzahlung", { personal: true }, true],
    ["Fiktiv Gym", "Fitness Monatsbeitrag", answer("sports-fitness", "memberships")],
    ["Fiktiv Streaming", "Film Abo", answer("subscriptions", "entertainment")],
    ["Fiktiv Hotel London", "Uebernachtung", answer("travel")],
    ["Fiktiv Museum London", "Eintritt", answer("entertainment", "hobbies")],
    ["Fiktiv Sprachschule", "Sprachkurs", answer("education")],
    ["Fiktiv Papierhaus", "Bueromaterial beruflich", answer("work")],
    ["Fiktiv Bestattungshaus", "Bestattung Rechnung", answer("other")],
    ["Fiktiv Dienst GmbH", "", { unclear: true }],
    ["Fiktiv Kasse", "Erstattung ohne Bezug", { personal: true }, true],
  ];
  const [name, purpose, label, incoming] = rows[i % rows.length];
  return { name, purpose, label, topic: `nonshop-${i % rows.length}`, service: "direct", amount: (incoming ? 1 : -1) * (7.13 + i * 2.17),
    foreign: [43, 44].includes(i % rows.length) };
}
const trades: [string, Answer][] = [
  ["Bäckerei", answer("groceries", "coffee-snacks")], ["Friseur", answer("personal-care")],
  ["Pizzeria", answer("eating-out")], ["Apotheke", answer("health")], ["Café", answer("coffee-snacks")],
  ["Kino", answer("entertainment")], ["Hotel", answer("travel")], ["Supermarkt", answer("groceries")],
  ["Tierbedarf", answer("pets")], ["Blumenladen", answer("household", "gifts")],
  ["Buchhandlung", answer("hobbies")], ["Autowerkstatt", answer("car-fuel")], ["Zahnarztpraxis", answer("health")],
  ["Fitnessstudio", answer("sports-fitness", "memberships")], ["Elektromarkt", answer("electronics")],
];

export async function make(): Promise<EvalCase[]> {
  const rows: EvalCase[] = [], brands = await nsiBrands(), known = await knownNames();
  const brandNames = new Set(brands.map((b) => nameKey(b.name)));
  const add = async (seed: string, kind: EvalCase["kind"], input: RenderInput, generator: Answer, facts: EvalCase["facts"], forced?: string) => {
    const id = opaqueId(seed), index = rows.length;
    const rendered = await render(input, index, forced);
    // A marketplace name alone conceals the actual purchase, even when the source identifies a specialist shop.
    if (rendered.rendering.service === "AMZN Mktp") generator = { ...answer("shopping"), personal: true };
    const row: EvalCase = { id, kind, ...rendered, generator, facts };
    rows.push(row); return row;
  };
  const places = await osmPlaces();
  for (const { place, elements } of places) {
    const weight = (e: typeof elements[number]) => /supermarket|convenience|bakery|butcher|greengrocer|cafe|restaurant|fast_food|chemist/.test(Object.values(cleanTags(e.tags)).join(" ")) ? 4 : 1;
    const chosen = [...elements].sort((a, b) => -Math.log(Math.max(random(`${place.name}/${a.type}/${a.id}`), 1e-9)) / weight(a)
      - -Math.log(Math.max(random(`${place.name}/${b.type}/${b.id}`), 1e-9)) / weight(b)).slice(0, place.target);
    for (const e of chosen) {
      const pseudonym = anonymise(e.tags.name, `${e.type}/${e.id}`, brandNames);
      const tags = { ...cleanTags(e.tags), name: pseudonym.name };
      await add(`osm/${e.type}/${e.id}`, "osm", { name: pseudonym.name, town: place.name.split(" ")[0], amount: -(4.19 + rows.length % 131 * 1.13) }, fromTags(tags),
        { source: "OpenStreetMap", osmType: e.type, osmId: e.id, place: place.name, tags, anonymised: pseudonym.changed });
    }
  }
  // Select by independently tagged NSI entries, then membership only. Balance known/unknown without using labels.
  const eligible = brands.filter((b) => !fromTags(b.tags).unclear);
  const unique = [...new Map(eligible.map((b) => [nameKey(b.name), b])).values()];
  const knownPool = ordered(unique.filter((b) => known.has(nameKey(b.name))), (b) => b.name);
  const unknownPool = ordered(unique.filter((b) => !known.has(nameKey(b.name))), (b) => b.name);
  const selected = [...knownPool.slice(0, 210), ...unknownPool.slice(0, 210)];
  if (selected.length !== 420) throw new Error(`Insufficient NSI brands: known ${knownPool.length}, unknown ${unknownPool.length}`);
  for (const b of selected) {
    const row = await add(`brand/${b.path}/${b.name}`, "brand", { name: b.name, amount: -(8.23 + rows.length % 117) }, fromTags(b.tags), { source: "name-suggestion-index", version: NSI.version, path: b.path, tags: b.tags, name: b.name });
    row.inShopList = known.has(nameKey(b.name));
  }
  for (const [name, purpose, label] of services) {
    const row = await add(`service/${name}`, "brand", { name, purpose, amount: -(11.27 + rows.length % 61), service: "direct" }, label, { source: "independent authored service description", name, purpose }, "ing.csv");
    row.inShopList = known.has(nameKey(name));
  }
  for (let i = 0; i < 230; i++) {
    const [trade, label] = trades[i % trades.length];
    let name = `${trade} ${inventedSurnames[i % 10]}${i >= 100 ? "tal" : "stern"}`;
    let generator = label, purpose: string | undefined;
    if (i >= 155 && i < 200) { name = `${inventedSurnames[i % 10]} Handels GmbH ${Math.floor(i / 10)}`; generator = { unclear: true }; }
    if (i >= 200) {
      const misleading: [string, string, Answer][] = [
        ["Bar Apotheke", "Cocktails Bar", answer("going-out")], ["Café Möbel Design", "Moebelkauf", answer("household")],
        ["Bäckerei Hotelblick", "Brot Einkauf", answer("groceries", "coffee-snacks")],
        ["Restaurant Garching", "Restaurant Rechnung", answer("eating-out")], ["Köln", "", { unclear: true }],
        ["Friseur Tankstelle", "Haarschnitt", answer("personal-care")],
      ];
      [name, purpose, generator] = misleading[i % misleading.length]; name += ` ${inventedSurnames[i % 10]}`;
    }
    const row = await add(`madeup/${i}`, "madeup", { name, purpose, amount: -(6.41 + i * 0.71), service: i >= 200 ? "direct" : undefined }, generator, { source: "invented", subtype: i < 155 ? "descriptive" : i < 200 ? "opaque" : "misleading" }, i >= 200 ? "ing.csv" : undefined);
    if (i < 20) {
      const twin = await render({ name, amount: row.payment.amount!, service: "direct" }, rows.length + 7, "camt053");
      rows.push({ ...row, ...twin, id: `${row.id}.2`, twinOf: row.id, generator: label });
    }
  }
  const bankLayouts = (await layouts()).map((l) => l.id);
  for (let i = 0; i < 500; i++) {
    const data = nonshop(i);
    const forcePaypal = i % 50 === 30 || i % 50 === 31;
    await add(`nonshop/${i}`, "nonshop", data, data.label, { source: "invented", topic: data.topic }, forcePaypal ? i % 2 ? "paypal-en" : "paypal-de" : bankLayouts[i % bankLayouts.length]);
  }
  for (let i = 0; i < 20; i++) {
    const group = opaqueId(`scenario/${i}`), amount = 31.47 + i * 3.13;
    const base = { source: "bank" as const, amount: -amount, currency: "EUR", date: "2026-07-11", account: "fict-giro", accountIban: IBANS[0], counterparty: person(i), description: "Umbuchung eigenes Konto" };
    let payments: EvalCase["payment"][], labels: Answer[];
    if (i % 3 === 0) {
      payments = [{ ...base, counterpartyIban: IBANS[1] }, { ...base, account: "fict-savings", accountIban: IBANS[1], counterpartyIban: IBANS[0], amount }];
      labels = [answer("own-transfers"), answer("own-transfers")];
    } else if (i % 3 === 1) {
      payments = [{ ...base, counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A.", description: "PP.4711.PP Ihr Einkauf bei Fiktiv Buchhandlung" },
        { ...base, source: "paypal", account: "fict-paypal", accountIban: null, counterparty: "Fiktiv Buchhandlung", description: "Fiktiv Buchhandlung", externalId: `FICT-SC-${i}` }];
      labels = [answer("own-transfers"), answer("hobbies", "education")];
    } else {
      payments = [{ ...base, counterparty: "Pizzeria Fiktiv", description: "Abendessen" }, { ...base, account: "fict-savings", accountIban: IBANS[1], amount, description: "Anteil Abendessen zurueck" }];
      labels = [answer("eating-out"), { ...answer("friends", "eating-out"), personal: true }];
    }
    payments.forEach((payment, j) => rows.push({ id: `${group}.${j + 1}`, group, kind: "scenario", payment, generator: labels[j],
      rendering: { layout: payment.source === "paypal" ? "paypal" : "bank", variation: "scenario", service: i % 3 === 1 ? "PayPal" : "direct", line: `${payment.counterparty} | ${payment.description}` },
      facts: { source: "invented", scenario: ["own-account-pair", "paypal-double-import", "equal-unrelated"][i % 3] } }));
  }
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("Duplicate generated ID");
  await mkdir(ROOT, { recursive: true });
  await writeLines(new URL("cases.jsonl", ROOT), rows.filter((c) => !heldback(c.id)));
  await writeLines(new URL("cases.heldback.jsonl", ROOT), rows.filter((c) => heldback(c.id)));
  // Initialise separate label files. A rebuild may refresh provisional labels but never erase judged labels.
  for (const [filename, held] of [["labels.jsonl", false], ["labels.heldback.jsonl", true]] as const) {
    const file = new URL(filename, ROOT);
    let previous: Label[] = [];
    try { previous = await readLines<Label>(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (!previous.some((label) => label.basis === "majority")) await writeLines(file, rows.filter((c) => heldback(c.id) === held).map(initialLabel));
  }
  const summary = { version: 1, seed: "aresium-sorting-v1", nsi: NSI, counts: Object.fromEntries(["osm", "brand", "madeup", "nonshop", "scenario"].map((kind) => [kind, rows.filter((r) => r.kind === kind).length])),
    places: places.map(({ place }) => ({ name: place.name, lat: place.lat, lon: place.lon, radius: place.radius, count: rows.filter((r) => r.facts.place === place.name).length })),
    brandMembership: { known: rows.filter((r) => r.kind === "brand" && r.inShopList).length, unknown: rows.filter((r) => r.kind === "brand" && !r.inShopList).length },
    layouts: Object.fromEntries([...new Set(rows.map((r) => r.rendering.layout))].map((l) => [l, rows.filter((r) => r.rendering.layout === l).length])),
    workedOn: rows.filter((r) => !heldback(r.id)).length, heldback: rows.filter((r) => heldback(r.id)).length,
    corpusHash: hash(rows.map((r) => JSON.stringify(r)).sort().join("\n")) };
  await writeFile(new URL("sources/manifest.json", ROOT), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  return rows;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await make();
