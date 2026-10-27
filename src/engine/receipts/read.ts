// A receipt's text, as the iPhone's Vision read it, → shop, date, total, currency and card or cash. The register's
// signed QR code wins where it speaks (./register-code.ts); otherwise the printed lines are read with the words of
// ./words.ts. Nothing is guessed: a value not found is null, and `sure` says which values came from a clear line.
import { parseAmountStrict, parseDate } from "../readers/values.js";
import { shopWords } from "../sorting/shop-words.js";
import { findShop, type ShopFound } from "../sorting/starter-rules.js";
import { readRegisterCode } from "./register-code.js";
import { receiptRows, type Observation } from "./rows.js";
import {
  CURRENCY_SIGNS, FUZZY_KINDS, FUZZY_MIN_LENGTH, ISO_CURRENCIES, KRONE_BY_PHONE, RECEIPT_WORDS, SHARED_WORDS, STREET_ENDINGS,
  type Language, type WordKind, type WordTable,
} from "./words.js";

export type { Observation } from "./rows.js";
export type { Language } from "./words.js";

/** What the app sends: Vision's text pieces and the payloads of any QR codes or barcodes on the receipt. */
export type ReceiptInput = { observations: readonly Observation[]; codes?: readonly string[] };

export type ReceiptReading = {
  /** The shop's name as printed (a chain's name as the list knows it, e.g. "REWE"), or null. */
  shop: string | null;
  /** The shop list's category id for the shop ("groceries"), or null when the shop is not on the list. */
  categoryId: string | null;
  /** `YYYY-MM-DD` and `HH:MM` (24 hours), or null. */
  date: string | null;
  time: string | null;
  /** The amount paid, in `currency`; null when no amount could be found. */
  total: number | null;
  /** ISO 4217 code; "EUR" when the receipt names no currency; null only for an undecided "kr". */
  currency: string | null;
  method: "card" | "cash" | null;
  /** The language whose receipt words matched, for the app's check window; null when none did. */
  language: Language | null;
  /** "code" when the register's QR code was read (its total, payment and time win over the printed text). */
  from: "code" | "text";
  /** The receipt's lines, top to bottom: what the app keeps instead of a photo (Cyrillic/Greek look-alikes made Latin). */
  rows: string[];
  /** True when the value came from the code or a clear line; false for a fallback (the app asks those first). */
  sure: { shop: boolean; date: boolean; total: boolean; method: boolean };
};

// ── The words ─────────────────────────────────────────────────────────────────────────────────────────────

type Phrase = { words: string[]; kind: WordKind; language: Language | null };
const phrasesOf = (table: WordTable, language: Language | null): Phrase[] =>
  Object.entries(table).flatMap(([kind, list]) => (list ?? []).map((text) => ({ words: shopWords(text), kind: kind as WordKind, language })));
const PHRASES: Phrase[] = [
  ...Object.entries(RECEIPT_WORDS).flatMap(([language, table]) => phrasesOf(table, language as Language)),
  ...phrasesOf(SHARED_WORDS, null),
].filter((p) => p.words.length > 0);
const BY_FIRST_WORD = new Map<string, Phrase[]>();
for (const p of PHRASES) BY_FIRST_WORD.set(p.words[0], [...(BY_FIRST_WORD.get(p.words[0]) ?? []), p]);
const FUZZY = PHRASES.filter((p) => p.words.length === 1 && FUZZY_KINDS.includes(p.kind) && p.words[0].length >= FUZZY_MIN_LENGTH);
const LANGUAGES = Object.keys(RECEIPT_WORDS) as Language[];

/** True when a and b differ by at most one letter added, dropped or changed. */
function nearlySame(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

type Hit = { start: number; end: number; kind: WordKind; language: Language | null; fuzzy: boolean; phrase: string };

/** The receipt words in a line; a match inside a longer one gives way to it. */
function hitsIn(words: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (let start = 0; start < words.length; start++) {
    for (const p of BY_FIRST_WORD.get(words[start]) ?? []) {
      const end = start + p.words.length;
      if (end <= words.length && p.words.every((w, k) => words[start + k] === w)) {
        hits.push({ start, end, kind: p.kind, language: p.language, fuzzy: false, phrase: p.words.join(" ") });
      }
    }
  }
  words.forEach((word, i) => {
    if (word.length < FUZZY_MIN_LENGTH - 1 || !/\p{L}/u.test(word) || hits.some((h) => h.start <= i && i < h.end)) return;
    for (const p of FUZZY) {
      if (nearlySame(word, p.words[0])) hits.push({ start: i, end: i + 1, kind: p.kind, language: p.language, fuzzy: true, phrase: p.words[0] });
    }
  });
  return hits.filter((h) => !hits.some((o) => o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
}

// ── Amounts, dates and times in a line ────────────────────────────────────────────────────────────────────

// An amount with two decimals: "23,40", "1.234,56", "1,234.56", "1'234.50", "-0,25", "0,25-", "€23.40", "12,50A".
// Not part of a longer number or a date ("27.10.26"), not a percentage, not a time ("14.32 Uhr").
const AMOUNT = /(?<![\p{L}\p{N}.,'])([-−–]\s?)?(?:US\$|CA\$|AU\$|R\$|[€£$]|EUR|CHF|GBP|USD)?\s?(\d{1,3}(?:[.,']\d{3})+|\d+)([.,])(\d{2})(?![\p{N}]|[.,]\d)(\s?[-−])?/gu;

/** OCR reads 0 as O inside prices: "2O,OO" → "20,00". Only a piece that is a price apart from its Os changes. */
const PRICE_WITH_OS = /^([-−]?[€£$]?)([\dOo]+(?:[.,'][\dOo]{3})*[.,][\dOo]{2})([-−]?[A-Z€£$]?)$/;
const zeroes = (text: string) => text.split(/(\s+)/).map((piece) => {
  const m = PRICE_WITH_OS.exec(piece);
  return m && /\d/.test(m[2]) ? m[1] + m[2].replace(/[Oo]/g, "0") + m[3] : piece;
}).join("");

function amountsIn(raw: string): number[] {
  const text = zeroes(raw).replace(/’/g, "'").replace(/(\d)\s*[xX*]\s*(\d)/g, "$1 x $2");
  const amounts: number[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const after = text.slice(m.index! + m[0].length);
    if (/^\s?(?:%|uhr\b|h\b)/iu.test(after)) continue;
    const value = parseAmountStrict(`${(m[1] ?? "").trim()}${m[2]}${m[3]}${m[4]}${(m[5] ?? "").trim()}`, m[3] === "," ? "de" : "en");
    if (value !== null) amounts.push(Number(value));
  }
  return amounts;
}

type DateHit = { day: string; ambiguous: boolean; utc: boolean };

// Month names in the seven languages (shopWords spelling: "März" → "maerz", "août" → "aout"); a word counts when it
// is a name or the start of one, at least three letters ("Okt", "févr.", "sept"). "mrt" is Dutch for maart.
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["january", "januar", "janvier", "gennaio", "enero", "januari", "janeiro", "jaenner"],
  ["february", "februar", "fevrier", "febbraio", "febrero", "februari", "fevereiro"],
  ["march", "maerz", "mars", "marzo", "maart", "marco", "mrt"],
  ["april", "avril", "aprile", "abril"],
  ["may", "mai", "maggio", "mayo", "mei", "maio"],
  ["june", "juni", "juin", "giugno", "junio", "junho"],
  ["july", "juli", "juillet", "luglio", "julio", "julho"],
  ["august", "aout", "agosto", "augustus"],
  ["september", "septembre", "settembre", "septiembre", "setembro"],
  ["october", "oktober", "octobre", "ottobre", "octubre", "outubro"],
  ["november", "novembre", "noviembre", "novembro"],
  ["december", "dezember", "decembre", "dicembre", "diciembre", "dezembro"],
];
const monthOf = (word: string): number | null => {
  const w = shopWords(word)[0] ?? "";
  if (w.length < 3) return null;
  const index = MONTH_NAMES.findIndex((names) => names.some((name) => name.startsWith(w)));
  return index < 0 ? null : index + 1;
};
const fullYear = (y: string) => (y.length === 2 ? `20${y}` : y);

/**
 * Dates in a line. Dots are always day first (27.10.2026); slashes and dashes day first, or month first on a dollar
 * receipt, each falling back to the other order when it is impossible; ISO dates (2026-10-27) as they are. The
 * reading itself is values.ts's parseDate.
 */
function datesIn(text: string, monthFirst: boolean): DateHit[] {
  const found: DateHit[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(T\d)?(?!\d)/g)) {
    const day = parseDate(`${m[1]}-${m[2]}-${m[3]}`, "YYYY-MM-DD");
    if (day) found.push({ day, ambiguous: false, utc: !!m[4] });
  }
  for (const m of text.matchAll(/(?<![\d./-])(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?![\d.]\d|\d)/g)) {
    const year = fullYear(m[4]);
    const dayFirst = parseDate(`${m[1]}.${m[3]}.${year}`, "DD.MM.YYYY");
    if (m[2] === ".") { if (dayFirst) found.push({ day: dayFirst, ambiguous: false, utc: false }); continue; }
    const monthFirstDay = parseDate(`${m[1]}/${m[3]}/${year}`, "MM/DD/YYYY");
    const day = monthFirst ? monthFirstDay ?? dayFirst : dayFirst ?? monthFirstDay;
    if (day) found.push({ day, ambiguous: !!dayFirst && !!monthFirstDay && dayFirst !== monthFirstDay, utc: false });
  }
  const named = [
    { re: /(?<!\d)(\d{1,2})\.?\s*(?:de\s+)?(\p{L}{3,})\.?,?\s*(?:de\s+)?(\d{4})(?!\d)/gu, d: 1, mo: 2, y: 3 },
    { re: /(?<!\p{L})(\p{L}{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/gu, d: 2, mo: 1, y: 3 },
  ];
  for (const { re, d, mo, y } of named) {
    for (const m of text.matchAll(re)) {
      const month = monthOf(m[mo]);
      const day = month && parseDate(`${m[d]}.${month}.${m[y]}`, "DD.MM.YYYY");
      if (day) found.push({ day, ambiguous: false, utc: false });
    }
  }
  return found;
}

const pad = (n: number) => String(n).padStart(2, "0");
function timesIn(text: string): string[] {
  const times: string[] = [];
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,2})(?::|h)(\d{2})(?::\d{2})?(?![\d])(?:\s*([ap])\.?\s?m\b\.?)?/giu)) {
    let hour = Number(m[1]);
    const minute = Number(m[2]);
    if (minute > 59) continue;
    if (m[3]) {
      if (hour < 1 || hour > 12) continue;
      hour = (hour % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    } else if (hour > 23) continue;
    times.push(`${pad(hour)}:${pad(minute)}`);
  }
  return times;
}

// ── One line, read ────────────────────────────────────────────────────────────────────────────────────────

type Line = {
  index: number; text: string; words: string[]; hits: Hit[]; kinds: Set<WordKind>;
  amounts: number[]; dates: DateHit[]; times: string[];
};
const has = (line: Line, ...kinds: WordKind[]) => kinds.some((k) => line.kinds.has(k));
const last = (line: Line) => line.amounts.at(-1) ?? null;
const cents = (n: number) => Math.round(n * 100);

function readLine(text: string, index: number, monthFirst: boolean): Line {
  const words = shopWords(text);
  const hits = hitsIn(words);
  const dates = datesIn(text, monthFirst);
  const times = timesIn(text);
  // A date line's numbers are not prices ("Fr 27.10. 14.32").
  const amounts = dates.length ? [] : amountsIn(text);
  return { index, text, words, hits, kinds: new Set(hits.map((h) => h.kind)), amounts, dates, times };
}

// ── Currency and language ─────────────────────────────────────────────────────────────────────────────────

// Signs only count next to prices; longer signs first ("US$" before "$"), each place in a line counted once.
const SIGNS = CURRENCY_SIGNS.map(([sign, code]) => {
  const escaped = sign.replace(/[.$]/g, "\\$&");
  return { code, re: new RegExp(/^\p{L}/u.test(sign) ? `(?<![\\p{L}])${escaped}(?![\\p{L}])` : escaped, "gu") };
});

function currencyOf(lines: Line[], totalLine: Line | null): string | null {
  const votes = new Map<string, number>();
  const vote = (code: string, weight: number) => votes.set(code, (votes.get(code) ?? 0) + weight);
  for (const line of lines) {
    const weight = line === totalLine ? 3 : 1;
    for (const code of line.text.match(/(?<![\p{L}])[A-Z]{3}(?![\p{L}])/gu) ?? []) if (ISO_CURRENCIES.includes(code)) vote(code, weight);
    if (!line.amounts.length) continue;
    let rest = line.text;
    for (const { code, re } of SIGNS) {
      const without = rest.replace(re, " ");
      if (without !== rest) { vote(code, weight); rest = without; }
    }
  }
  if (votes.size === 0) return "EUR";
  const [best] = [...votes].sort((a, b) => b[1] - a[1]);
  if (best[0] !== "kr") return best[0];
  // "kr": the ISO code or the country's phone prefix decides; otherwise it stays open.
  const iso = ["SEK", "NOK", "DKK", "ISK"].find((code) => votes.has(code));
  if (iso) return iso;
  const all = lines.map((l) => l.text).join(" ");
  const phone = Object.keys(KRONE_BY_PHONE).find((prefix) => all.includes(prefix));
  return phone ? KRONE_BY_PHONE[phone] : null;
}

function languageOf(lines: Line[], currency: string | null): Language | null {
  const score = new Map<Language, Set<string>>();
  for (const line of lines) for (const h of line.hits) {
    if (h.language) score.set(h.language, (score.get(h.language) ?? new Set()).add(h.phrase));
  }
  let best: Language | null = null, bestScore = 0;
  for (const language of LANGUAGES) {
    // Pounds and dollars lean English when the words alone do not decide.
    const s = (score.get(language)?.size ?? 0) + (language === "en" && (currency === "GBP" || currency === "USD") ? 0.5 : 0);
    if (s > bestScore) { best = language; bestScore = s; }
  }
  return score.size ? best : null;
}

// ── The total ─────────────────────────────────────────────────────────────────────────────────────────────

const STRENGTH: Partial<Record<WordKind, number>> = { due: 3, total: 2, amount: 1 };
const TOTAL_KINDS: WordKind[] = ["due", "total", "amount"];
const NEVER_TOTAL: WordKind[] = ["subtotal", "tax", "deposit", "tip", "other", "given", "change"];
type Candidate = { line: Line; amount: number; strength: number; fuzzy: boolean };

function totalOf(lines: Line[]): { total: number | null; sure: boolean; line: Line | null; first: Line | null } {
  const candidates: Candidate[] = [];
  for (const line of lines) {
    const amount = last(line);
    if (amount === null || amount <= 0 || has(line, ...NEVER_TOTAL)) continue;
    const totalHits = line.hits.filter((h) => STRENGTH[h.kind]);
    if (!totalHits.length) continue;
    const strength = Math.max(...totalHits.map((h) => STRENGTH[h.kind]!));
    candidates.push({ line, amount, strength, fuzzy: totalHits.every((h) => h.fuzzy) });
  }
  // The change maths: given − change = total, from the payment lines (the first total line and below).
  const paying = candidates.length ? lines.slice(candidates[0].line.index) : lines;
  const given = paying.find((l) => has(l, "given") && !has(l, "change", "card") && (last(l) ?? 0) > 0)
    ?? paying.find((l) => has(l, "cash") && !has(l, "card", "change", ...TOTAL_KINDS) && (last(l) ?? 0) > 0);
  const change = paying.find((l) => has(l, "change") && !has(l, "deposit") && last(l) !== null && last(l)! >= 0);
  const byChange = given && change ? (cents(last(given)!) - cents(last(change)!)) / 100 : null;
  const tips = lines.filter((l) => has(l, "tip") && (last(l) ?? 0) > 0).map((l) => last(l)!);

  if (candidates.length) {
    const top = Math.max(...candidates.map((c) => c.strength));
    const best = candidates.filter((c) => c.strength === top);
    const amounts = [...new Set(best.map((c) => cents(c.amount)))];
    const confirmed = (c: Candidate) => byChange !== null && cents(c.amount) === cents(byChange);
    let pick: Candidate, sure: boolean;
    if (amounts.length === 1) {
      pick = best.find((c) => !c.fuzzy) ?? best[0];
      sure = !pick.fuzzy || confirmed(pick);
    } else {
      // Two totals that differ: a tip line explains the larger one (the amount paid), or the change maths picks one.
      const byTip = best.find((b) => best.some((a) => tips.some((t) => cents(a.amount) + cents(t) === cents(b.amount))));
      const explained = byTip ?? best.find(confirmed);
      pick = explained ?? best.at(-1)!;
      sure = !!explained && (!pick.fuzzy || confirmed(pick));
    }
    if (byChange !== null && !confirmed(pick)) sure = false;
    return { total: pick.amount, sure, line: pick.line, first: candidates[0].line };
  }
  // No total line: the change maths when a printed amount confirms it, else the largest plain amount.
  const plain = lines.filter((l) => !has(l, "given", "change", "tax", "other", "deposit", "tip") && (last(l) ?? 0) > 0);
  const confirmedLine = byChange !== null && byChange > 0 ? plain.find((l) => l.amounts.some((a) => cents(a) === cents(byChange))) : undefined;
  if (confirmedLine) return { total: byChange, sure: false, line: confirmedLine, first: null };
  let largest: Line | null = null;
  for (const l of plain) if (!largest || last(l)! > last(largest)!) largest = l;
  return { total: largest ? last(largest) : null, sure: false, line: largest, first: null };
}

// ── Card or cash ──────────────────────────────────────────────────────────────────────────────────────────

/** From the payment lines (the total line and below): card words, or cash paid, given or changed. Both: null. */
function methodOf(lines: Line[]): "card" | "cash" | null {
  const card = lines.some((l) => has(l, "card") && !has(l, "other", "deposit"));
  const cash = lines.some((l) => !has(l, "card", "deposit") && (last(l) ?? 0) > 0 && has(l, "cash", "given", "change"));
  return card === cash ? null : card ? "card" : "cash";
}

// ── The date ──────────────────────────────────────────────────────────────────────────────────────────────

function dateOf(lines: Line[]): { date: string | null; time: string | null; sure: boolean } {
  let best: { line: Line; hit: DateHit; score: number } | null = null;
  const all: { hit: DateHit; score: number; utc: boolean }[] = [];
  for (const line of lines) for (const hit of line.dates) {
    // The purchase date stands with a time or a date word; coupon and best-before dates have validity words; the
    // register's TSE lines are in UTC, a day off near midnight.
    const utc = hit.utc || line.words.includes("tse");
    const score = (line.times.length ? 2 : 0) + (has(line, "date") ? 1 : 0) - (has(line, "validity") ? 3 : 0) - (utc ? 1 : 0);
    all.push({ hit, score, utc });
    if (!best || score > best.score) best = { line, hit, score };
  }
  if (!best) return { date: null, time: null, sure: false };
  const { line, hit } = best;
  const near = [line, lines[line.index + 1], lines[line.index - 1]].filter(Boolean);
  const time = near.find((l) => l.times.length)?.times[0] ?? null;
  const others = all.filter((d) => d.score >= 0 && !d.utc && d.hit.day !== hit.day);
  return { date: hit.day, time, sure: !hit.ambiguous && others.length === 0 };
}

// ── The shop ──────────────────────────────────────────────────────────────────────────────────────────────

const WEB = /https?:|www\.|@|\.(?:de|com|fr|it|es|nl|pt|ch|at|be|uk)\b/i;
function isAddress(line: Line): boolean {
  const t = line.text;
  if (/\d/.test(t) && (has(line, "street") || line.words.some((w) => STREET_ENDINGS.some((e) => w.length > e.length + 2 && w.endsWith(e))))) return true;
  return /\b\d{4,5}\s+\p{L}{2,}/u.test(t) // postcode and town
    || /\b\d{4}-\d{3}\b/.test(t) // Portugal
    || /\b\d{4}\s?[A-Z]{2}\b/.test(t) // the Netherlands
    || /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/.test(t) // the UK
    || /\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/.test(t); // the US
}
/** A line that can be a shop's name: not an address, phone number, tax id, date, register, payment or greeting line. */
function isNameLine(line: Line): boolean {
  const letters = (line.text.match(/\p{L}/gu) ?? []).length;
  const digits = (line.text.match(/\p{N}/gu) ?? []).length;
  if (letters < 2 || digits > letters || line.amounts.length || line.dates.length || line.times.length) return false;
  if (has(line, "due", "total", "amount", "subtotal", "tax", "card", "cash", "given", "change", "register", "greeting", "phone", "date", "validity")) return false;
  return !isAddress(line) && !WEB.test(line.text) && !/\b[A-Z]{2}\s?\d{8,12}\b/.test(line.text) && !/\d[\d\s/-]{5,}\d/.test(line.text);
}

/** The words of a line as printed, in step with shopWords (null when they do not line up). */
function printedWords(text: string): { index: number; end: number }[] | null {
  const tokens = [...text.normalize("NFC").matchAll(/[\p{L}\p{M}\p{N}'’‘`´]+|[&+]/gu)].filter((m) => shopWords(m[0]).length === 1);
  return tokens.length === shopWords(text).length ? tokens.map((m) => ({ index: m.index!, end: m.index! + m[0].length })) : null;
}
const chainLike = (found: ShopFound) => found.source !== "rule" || found.direction === "both";
const clean = (text: string) => text.replace(/\s+/g, " ").replace(/^[\s*#.,:;|-]+|[\s*#,:;|-]+$/g, "");

function shopIn(text: string, found: ShopFound, whole: boolean): string {
  if (whole && !chainLike(found)) return clean(text);
  const spans = found.at && printedWords(text);
  if (!spans || !found.at) return clean(text);
  return clean(text.slice(spans[found.at[0]].index, spans[found.at[1] - 1].end));
}

function shopOf(lines: Line[], itemsFrom: number, itemsTo: number): { shop: string | null; categoryId: string | null; sure: boolean } {
  const find = (text: string) => findShop({ counterparty: text, amount: -1 });
  // 1. The top lines (above the first price): a chain the list knows, as the list knows it ("REWE Markt GmbH" →
  //    "REWE"; also on a line with a receipt word: "Netto Marken-Discount", "Willkommen bei ALDI"), or another name
  //    the list sorts, as printed ("Bäckerei Schmidt"). The first name line may also start with a chain ("PENNY Markt").
  const top = lines.slice(0, Math.min(itemsFrom, 10))
    .filter((l) => !l.amounts.length && !l.dates.length && !l.times.length && !isAddress(l) && !WEB.test(l.text));
  for (const line of top) {
    const found = find(line.text);
    if (found && (chainLike(found) || isNameLine(line))) return { shop: shopIn(line.text, found, true), categoryId: found.categoryId, sure: true };
  }
  const header = top.filter(isNameLine);
  if (header.length) {
    const first = header[0].text.split(/\s+/)[0];
    const found = first ? find(first) : null;
    if (found && chainLike(found)) return { shop: clean(first), categoryId: found.categoryId, sure: true };
  }
  // 2. A chain's name anywhere outside the items (a logo printed as an image, the company line at the bottom); not
  //    on total and payment lines ("TOTAL" is also a chain of petrol stations).
  for (const line of lines) {
    if ((line.index >= itemsFrom && line.index < itemsTo) || has(line, "due", "total", "amount", "card", "cash", "given", "change")) continue;
    const found = find(line.text);
    if (found && chainLike(found)) return { shop: shopIn(line.text, found, false), categoryId: found.categoryId, sure: true };
  }
  // 3. The first line that is a name, without a category.
  return header.length ? { shop: clean(header[0].text), categoryId: null, sure: false } : { shop: null, categoryId: null, sure: false };
}

// ── The receipt ───────────────────────────────────────────────────────────────────────────────────────────

export function readReceipt(input: ReceiptInput): ReceiptReading {
  const rows = receiptRows(input?.observations ?? []);
  // Dollars decide month-first dates, so read the currency from a first pass.
  const firstPass = rows.map((text, i) => readLine(text, i, false));
  const dollars = currencyOf(firstPass, null) === "USD";
  const lines = dollars ? rows.map((text, i) => readLine(text, i, true)) : firstPass;

  const total = totalOf(lines);
  const currency = currencyOf(lines, total.line);
  const firstAmount = lines.findIndex((l) => l.amounts.length > 0);
  const itemsFrom = firstAmount < 0 ? lines.length : firstAmount;
  const itemsTo = total.first?.index ?? total.line?.index ?? lines.length;
  const payment = lines.slice(total.first?.index ?? 0);
  const method = methodOf(payment);
  const date = dateOf(lines);
  const shop = shopOf(lines, itemsFrom, itemsTo);
  const reading: ReceiptReading = {
    shop: shop.shop, categoryId: shop.categoryId, date: date.date, time: date.time, total: total.total, currency, method,
    language: languageOf(lines, currency), from: "text", rows,
    sure: { shop: shop.sure, date: date.sure, total: total.sure, method: method !== null },
  };

  const code = (input?.codes ?? []).map(readRegisterCode).find((c) => c !== null);
  if (!code) return reading;
  return {
    ...reading,
    from: "code",
    total: code.total,
    currency: "EUR",
    method: code.method ?? reading.method,
    date: code.date ?? reading.date,
    time: code.date ? code.time : reading.time,
    sure: { shop: shop.sure, date: code.date ? true : date.sure, total: true, method: code.method !== null },
  };
}
