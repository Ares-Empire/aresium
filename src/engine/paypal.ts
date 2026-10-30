// PayPal's own export, as the dashboard counts it. Two rules, used by buildDashboardSource (./source.ts).
//
// Bank funding: "Bankgutschrift auf PayPal-Konto" is the bank paying for a PayPal purchase (money moving
// bank → PayPal), not income. The real expense is the separate PayPal payment row, so these funding rows are left
// out of every dashboard figure. English exports name them differently (ENGLISH_FUNDING below).
//
// Foreign currency: PayPal pays a purchase in a foreign currency with three rows, linked by the purchase's
// transaction code:
//   the purchase                       USD −105.91   (Typ "PayPal Express-Zahlung", Transaktionscode X)
//   a conversion into that currency    USD +105.91   (Typ "Allgemeine Währungsumrechnung", related code X)
//   a conversion out of euros          EUR  −95.07   (same type, related code X)  ← what it really cost
// The dashboard counts the purchase at its euro cost (keeping its category, tags and place) and leaves both
// conversion rows out. If the euro row is missing, the rows stay as they are and the code is reported, so a
// gap is visible instead of silently dropping spending. Decided with Patrik 2026-10-24.

// PayPal's English names for money arriving in PayPal from the person's own bank account or card (checked
// 2026-10-27). The activity download writes "Bank Deposit to PP Account" (often with a trailing space) for a bank
// account and "General Card Deposit", in older files "General Credit Card Deposit", for a card: seen in public
// importers' test files made from real exports, e.g. github.com/metabrainz/metabrainz.org misc/parse-paypal-us.py,
// github.com/davistroy/open-brain scripts/financial-pipeline.py, github.com/NikolayMetchev/money-manager
// PayPalCsvE2ETest.kt. The rest are PayPal's own names for the same transaction event codes, T0300–T0303 (bank
// deposit into the PayPal account) and T0700–T0701 (credit card deposit):
// https://developer.paypal.com/docs/transaction-search/transaction-event-codes/
// Compared as whole values (a type column, or the description), never as part of a longer text.
const ENGLISH_FUNDING = new Set([
  "bank deposit to pp account",
  "general card deposit",
  "general credit card deposit",
  "bank deposit to paypal account",
  "paypal balance manager funding of paypal account",
  "ach funding for funds recovery from account balance",
  "electronic funds transfer funding",
  "credit card deposit for negative paypal account balance",
]);
const plain = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "");

/**
 * A PayPal row funded from the person's bank account or card: "Bankgutschrift auf PayPal-Konto" in its text or
 * original row, or one of PayPal's English names for it as its text or as a value of its original row.
 */
export function isPaypalBankFunding(t: { description: string; raw?: unknown }): boolean {
  const hay = (t.description + " " + JSON.stringify(t.raw ?? "")).toLowerCase();
  if (hay.includes("bankgutschrift auf paypal")) return true;
  const values = t.raw && typeof t.raw === "object" ? Object.values(t.raw as Record<string, unknown>) : [];
  return [t.description, ...values].some((value) => ENGLISH_FUNDING.has(plain(value)));
}

// PayPal's T0400 (General withdrawal — bank account) and T0403 (Manual withdrawal, user-initiated):
// https://developer.paypal.com/docs/transaction-search/transaction-event-codes/ (checked 2026-10-30).
// Activity exports also call the latter "User Initiated Withdrawal". T0401 auto-sweep and T0402 Hyperwallet
// are not user-initiated bank withdrawals; neither are ATM/card withdrawals or withdrawal fees.
const BANK_WITHDRAWALS = new Set([
  "von nutzer eingeleitete abbuchung", "user initiated withdrawal", "manual withdrawal", "general withdrawal bank account",
]);

/** Money moving from PayPal to the person's bank, regardless of the export's status or amount sign. */
export function isPaypalBankWithdrawal(t: { description: string; raw?: unknown }): boolean {
  return [t.description, field(t.raw, ["Typ", "Type", "Beschreibung"])].some((value) =>
    BANK_WITHDRAWALS.has(plain(value).replace(/[–—]/gu, "-").replace(/\s*-\s*/gu, " ")));
}

const CONVERSION_TYPES = new Set(["Allgemeine Währungsumrechnung", "General Currency Conversion"]);
const TYPE_KEYS = ["Typ", "Type"];
const RELATED_KEYS = ["Zugehöriger Transaktionscode", "Reference Txn ID"];
const EUR = "EUR";

type Row = { externalId: string | null; currency: string; amount: unknown; raw?: unknown };
type ConversionRow = { externalId?: string | null; currency?: string | null; amount?: unknown; raw?: unknown };

function field(raw: unknown, keys: string[]): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const isConversion = (row: ConversionRow) => CONVERSION_TYPES.has(field(row.raw, TYPE_KEYS) ?? "");

function conversionPlan<T extends ConversionRow>(rows: readonly T[]) {
  const eurLegByPurchase = new Map<string, T>();
  const conversionsByPurchase = new Map<string, T[]>();
  for (const row of rows) {
    if (!isConversion(row)) continue;
    const purchase = field(row.raw, RELATED_KEYS);
    if (!purchase) continue;
    conversionsByPurchase.set(purchase, [...(conversionsByPurchase.get(purchase) ?? []), row]);
    if (row.currency === EUR) eurLegByPurchase.set(purchase, row);
  }

  const dropped = new Set<T>();
  const replaced = new Map<T, T>();
  const unmatched: string[] = [];
  for (const row of rows) {
    if (row.currency === EUR || isConversion(row) || !row.externalId) continue;
    const eurLeg = eurLegByPurchase.get(row.externalId);
    if (!eurLeg) { unmatched.push(row.externalId); continue; }
    replaced.set(row, { ...row, amount: eurLeg.amount, currency: EUR });
    for (const conversion of conversionsByPurchase.get(row.externalId) ?? []) dropped.add(conversion);
  }
  return { dropped, replaced, unmatched };
}

/** The conversion rows the dashboard leaves out, also used by sorting's own-transfer rule. */
export function paypalConversionRows<T extends ConversionRow>(rows: readonly T[]): ReadonlySet<T> {
  return conversionPlan(rows).dropped;
}

export function foldPaypalConversions<T extends Row>(rows: T[]): { rows: T[]; unmatched: string[] } {
  const { dropped, replaced, unmatched } = conversionPlan(rows);
  return {
    rows: rows.filter((row) => !dropped.has(row)).map((row) => replaced.get(row) ?? row),
    unmatched,
  };
}
