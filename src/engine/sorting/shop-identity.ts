import { compileShopList, type ShopListData } from "./shop-matcher.js";
import { shopWords } from "./shop-words.js";
import shopList from "./shops.de.json" with { type: "json" };

// The list separates named providers from generic category words in blocks. Generic words such as "cafe",
// "apotheke" and "miete" describe many unrelated payees, so they cannot be shop identities. Keep the named
// blocks (including the directional platforms), plus all whole merchants and NSI brands. No categories change.
const directionalProviders = new Set([
  "momox", "uber eats", "uber trip", "goflink", "booking.com", "fansale", "momox fashion", "vinted", "gofundme",
]);
const genericSavings = new Set([
  "sparplan", "tagesgeld", "festgeld", "sparkonto", "sparbuch", "wertpapierkauf", "wertpapierabrechnung", "etf",
  "vermögenswirksame leistungen", "bausparkasse", "bausparvertrag", "bausparen",
]);
const list = shopList as unknown as ShopListData;
const matcher = compileShopList({
  ...list,
  rules: list.rules.filter(([category, names, direction]) =>
    (direction === "both" && category !== "own-transfers") || directionalProviders.has(names[0]))
    .map(([category, names, direction]) => [category,
      category === "savings-investing" ? names.filter((name) => !genericSavings.has(name)) : names, direction]),
});

// Identity aliases only: the shop list still decides categories and directions. Apple services and its billing
// company have no standalone list entry; these exact names belong with the listed Apple store/billing names.
const aliases = new Map([
  ["kleiderkreisel", "vinted"], ["apple", "apple"], ["apple services", "apple"],
  ["apple com bill", "apple"], ["apple store", "apple"], ["apple distribution international", "apple"],
  ["apple music", "apple"], ["apple tv", "apple"],
]);

// Applied only at the end, in runs ("Pte. Ltd.", "GmbH & Co. KG"). Short forms such as AS, AB and SE are
// ordinary words elsewhere. Longest phrases come first. Punctuation has already become spaces.
const legalSuffix = /(?:^| )(?:ug haftungsbeschraenkt|gmbh (?:und )?co kg|pte ltd|sp z o o|s a r l|s r l|s p a|s l|s a|b v|n v|e v|e k|uab|aps|ltd|limited|sas|sarl|ab|as|oy|inc|llc|corp|plc|pty|ohg|mbh|ug|ggmbh|kgaa|aktiengesellschaft|gmbh|ag|se|kg)$/u;

function cleaned(key: string): string {
  let text = shopWords(key.replace(/['’‘`´]/gu, " ")).filter((word) => word !== "&" && word !== "+").join(" ")
    .replace(/\bsagt danke\b|\bdankt\b/gu, " ").replace(/\s+/gu, " ").trim();
  let previous: string;
  do { previous = text; text = text.replace(legalSuffix, "").trim(); } while (text !== previous);
  return text;
}

function knownShop(key: string, text: string): string | null {
  const alias = aliases.get(text);
  if (alias) return alias;
  const found = matcher.find({ counterparty: key }) ?? matcher.find({ counterparty: text });
  return found ? aliases.get(found.name) ?? found.name : null;
}

// Longest wins, with a code-point lexical tie break (independent of the host locale and input order).
function longer(a: string, b: string): string {
  return a.length > b.length || (a.length === b.length && a < b) ? a : b;
}
type PrefixNode = { children: Map<string, PrefixNode>; best: string; lastWord: string };
const node = (): PrefixNode => ({ children: new Map(), best: "", lastWord: "" });

/**
 * One identity per merchant key, in input order. Only distinct keys are processed. Known shops win; unknowns
 * join by 2–4 digit-free words (permutations or equal first/last words), then by a >=12-character prefix ending
 * at a word boundary or inside the longer name's last word. Prefix ties choose the lexical first longest name.
 * Name groups use their fewest-word, lexical first member, unless a prefix leads to a longer name's identity.
 * Identities of unknown names depend on the supplied set; callers must pass all keys they want to compare.
 */
export function shopIdentities(keys: string[]): string[] {
  const forms = new Map<string, string>();
  const known = new Map<string, string>();
  for (const key of new Set(keys)) {
    const text = cleaned(key);
    forms.set(key, text);
    if (!text) continue;
    const shop = knownShop(key, text);
    if (shop && (!known.has(text) || shop < known.get(text)!)) known.set(text, shop);
  }
  const names = [...new Set(forms.values())].filter(Boolean).sort();
  const parent = new Map(names.map((name) => [name, name]));
  const anchors = new Map(known);
  const root = (name: string): string => {
    let current = name;
    while (parent.get(current) !== current) current = parent.get(current)!;
    while (name !== current) { const next = parent.get(name)!; parent.set(name, current); name = next; }
    return current;
  };
  const join = (a: string, b: string) => {
    const left = root(a), right = root(b);
    if (left === right) return;
    const leftShop = anchors.get(left), rightShop = anchors.get(right);
    if (leftShop && rightShop && leftShop !== rightShop) return;
    parent.set(right, left);
    anchors.delete(right);
    if (rightShop) anchors.set(left, rightShop);
  };
  const permutations = new Map<string, string>(), endpoints = new Map<string, string>();
  for (const name of names) {
    const words = name.split(" ");
    if (words.length < 2 || words.length > 4 || /\p{N}/u.test(name)) continue;
    for (const [index, signature] of [
      [permutations, [...words].sort().join(" ")], [endpoints, `${words[0]} ${words.at(-1)}`],
    ] as const) {
      const previous = index.get(signature);
      if (previous) join(name, previous); else index.set(signature, name);
    }
  }

  // A trie makes prefix lookup linear in the text size rather than comparing every pair of names. `lastWord`
  // holds only descendants reached without crossing another space; `best` holds every descendant.
  const trie = node(), ends = new Map<string, PrefixNode>();
  for (const name of names) {
    let current = trie, position = 0;
    const lastSpace = name.lastIndexOf(" ");
    for (const letter of name) {
      let child = current.children.get(letter);
      if (!child) { child = node(); current.children.set(letter, child); }
      current = child;
      position += letter.length;
      current.best = longer(current.best, name);
      if (position > lastSpace) current.lastWord = longer(current.lastWord, name);
    }
    ends.set(name, current);
  }
  const representatives = new Map<string, string>(), extensions = new Map<string, string>();
  for (const name of names) {
    const group = root(name), previous = representatives.get(group);
    if (!previous || name.split(" ").length < previous.split(" ").length
      || (name.split(" ").length === previous.split(" ").length && name < previous)) representatives.set(group, name);
    if (anchors.has(group) || name.length < 12) continue;
    const end = ends.get(name)!;
    const target = longer(end.children.get(" ")?.best ?? "", end.lastWord);
    if (target.length <= name.length || root(target) === group) continue;
    extensions.set(group, longer(extensions.get(group) ?? "", target));
  }

  // Prefixes are directional: a short ambiguous prefix chooses one longest completion, and never joins two
  // different completions. Resolve groups once. A cycle introduced by reordered words uses a stable member.
  const identities = new Map<string, string>();
  for (const name of names) {
    let group = root(name);
    const path: string[] = [], positions = new Map<string, number>();
    let identity: string;
    while (true) {
      const saved = identities.get(group);
      if (saved !== undefined) { identity = saved; break; }
      const repeated = positions.get(group);
      if (repeated !== undefined) {
        identity = path.slice(repeated).map((item) => representatives.get(item)!).sort()[0];
        break;
      }
      positions.set(group, path.length);
      path.push(group);
      const representative = representatives.get(group)!;
      const shop = anchors.get(group);
      if (shop) { identity = shop; break; }
      const target = extensions.get(group);
      if (!target) { identity = representative; break; }
      group = root(target);
    }
    for (const item of path) identities.set(item, identity);
  }
  return keys.map((key) => {
    const text = forms.get(key)!;
    return text ? identities.get(root(text))! : "";
  });
}
