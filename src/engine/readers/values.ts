// Reading single cells: dates and amounts in a stated format, IBANs, and header names for comparison.
// Strict on purpose: the layout guesser decides what a column holds by which of these accept its values.

export type DateFormat = "DD.MM.YYYY" | "DD.MM.YY" | "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "DD-MM-YYYY" | "YYYYMMDD";
export const DATE_FORMATS: readonly DateFormat[] = ["DD.MM.YYYY", "DD.MM.YY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "YYYYMMDD"];

// "de": 1.234,56 (decimal comma); "en": 1,234.56 (decimal point).
export type NumberFormat = "de" | "en";

const DATE_PATTERNS: Record<DateFormat, { re: RegExp; order: [number, number, number] }> = {
  // order: the match groups holding year, month, day. A time after the date ("2024-01-05 10:22:33") is ignored.
  "DD.MM.YYYY": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:$|[\sT,])/, order: [3, 2, 1] },
  "DD.MM.YY": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{2})(?:$|[\sT,])/, order: [3, 2, 1] },
  "YYYY-MM-DD": { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[\sT,])/, order: [1, 2, 3] },
  "DD/MM/YYYY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|[\sT,])/, order: [3, 2, 1] },
  "MM/DD/YYYY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|[\sT,])/, order: [3, 1, 2] },
  "DD-MM-YYYY": { re: /^(\d{1,2})-(\d{1,2})-(\d{4})(?:$|[\sT,])/, order: [3, 2, 1] },
  "YYYYMMDD": { re: /^(\d{4})(\d{2})(\d{2})$/, order: [1, 2, 3] },
};

// "YYYY-MM-DD" when the cell is a real calendar date in that format, else null.
export function parseDate(value: string, format: DateFormat): string | null {
  const { re, order } = DATE_PATTERNS[format];
  const m = re.exec(value.trim());
  if (!m) return null;
  let year = +m[order[0]];
  if (m[order[0]].length === 2) year += 2000;
  const month = +m[order[1]], day = +m[order[2]];
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// A plain decimal string: optional "-", digits, "." and at least two decimals ("12.30", "-1234.56", "0.1234").
// Equal amounts always give the same string, which the payment ids rely on.
export function canonicalAmount(negative: boolean, whole: string, fraction: string): string {
  const intPart = whole.replace(/^0+(?=\d)/, "") || "0";
  let frac = fraction.padEnd(2, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  const zero = /^0*$/.test(intPart + frac);
  return `${negative && !zero ? "-" : ""}${intPart}.${frac}`;
}

const MINUS = /^[-−–]/;

// Reads an amount such as "-1.234,56", "1.234,56 €", "12,34-", "+12,34", "(12.34)", "EUR 12.34" in the given
// format. Returns null for anything else (so dates, account numbers and words are rejected).
export function parseAmountStrict(value: string, format: NumberFormat): string | null {
  let v = value.trim().replace(/[\s  ']/g, "");
  v = v.replace(/^(EUR|USD|GBP|CHF|€|\$|£)/i, "").replace(/(EUR|USD|GBP|CHF|€|\$|£)$/i, "");
  let negative = false;
  if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1); }
  if (MINUS.test(v)) { negative = !negative; v = v.slice(1); }
  else if (v.startsWith("+")) v = v.slice(1);
  else if (/[-−]$/.test(v)) { negative = !negative; v = v.slice(0, -1); }
  else if (v.endsWith("+")) v = v.slice(0, -1);
  const [group, decimal] = format === "de" ? [".", ","] : [",", "."];
  const groupRe = group === "." ? "\\." : ",";
  const decimalRe = decimal === "." ? "\\." : ",";
  const re = new RegExp(`^(\\d{1,3}(?:${groupRe}\\d{3})+|\\d+)(?:${decimalRe}(\\d+))?$|^${decimalRe}(\\d+)$`);
  const m = re.exec(v);
  if (!m) return null;
  if (m[3] !== undefined) return canonicalAmount(negative, "0", m[3]);
  return canonicalAmount(negative, m[1].split(group).join(""), m[2] ?? "");
}

// True when the amount string is negative.
export const isNegative = (amount: string) => amount.startsWith("-");
export const negate = (amount: string) => (isNegative(amount) ? amount.slice(1) : /^0\.0+$/.test(amount) ? amount : `-${amount}`);
export const absolute = (amount: string) => (isNegative(amount) ? amount.slice(1) : amount);

// Adds two canonical amounts exactly (in hundred-thousandths, enough for any bank amount).
const SCALE = 5;
function toUnits(amount: string): bigint {
  const negative = isNegative(amount);
  const [whole, fraction = ""] = absolute(amount).split(".");
  const units = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction.padEnd(SCALE, "0").slice(0, SCALE) || "0");
  return negative ? -units : units;
}
function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(SCALE + 1, "0");
  return canonicalAmount(negative, digits.slice(0, -SCALE), digits.slice(-SCALE));
}
export const addAmounts = (a: string, b: string) => fromUnits(toUnits(a) + toUnits(b));
export const sameAmount = (a: string, b: string) => toUnits(a) === toUnits(b);

// IBAN check (ISO 13616, mod 97). Spaces are allowed, as banks print them in groups of four.
export function normalizeIban(value: string): string | null {
  const v = value.replace(/[\s'"]/g, "").toUpperCase(); // Targobank writes 'DE…'
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return null;
  const moved = v.slice(4) + v.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = ch >= "A" ? ch.charCodeAt(0) - 55 : +ch;
    rest = n >= 10 ? (rest * 100 + n) % 97 : (rest * 10 + n) % 97;
  }
  return rest === 1 ? v : null;
}

// Header names compared without case, umlauts, punctuation or spacing: "Betrag (€)" and "Betrag (EUR)" are both
// "betrageur", "Zahlungspflichtige*r" is "zahlungspflichtiger".
export function headerKey(name: string): string {
  return name.normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/€/g, "eur")
    .replace(/[^a-z0-9]/g, "");
}

// Text cells joined with single spaces.
export function cleanText(...parts: (string | undefined)[]): string {
  return parts.map((p) => (p ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

const SEPA_KEYS = /(EREF|KREF|MREF|CRED|DEBT|SVWZ|ABWA|ABWE|COAM|OAMT|IBAN|BIC)\+/g;

// The payment text of a SEPA text with keys (MT940 :86:, and CSVs made from it): the "SVWZ+" part; without one,
// the text before the first key; "" when the text holds only keys. A text without keys stays as it is.
export function sepaPaymentText(text: string): string {
  const keys = [...text.matchAll(SEPA_KEYS)];
  const svwz = keys.findIndex((m) => m[1] === "SVWZ");
  if (svwz < 0) return cleanText(text.slice(0, keys[0]?.index ?? text.length));
  const start = keys[svwz].index! + 5;
  const end = keys[svwz + 1]?.index ?? text.length;
  return cleanText(text.slice(start, end));
}
