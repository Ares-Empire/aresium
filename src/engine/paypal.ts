// PayPal's own export, as the dashboard counts it. Two rules, used by buildDashboardSource (./source.ts).
//
// Bank funding: "Bankgutschrift auf PayPal-Konto" is the bank paying for a PayPal purchase (money moving
// bank → PayPal), not income. The real expense is the separate PayPal payment row, so these funding rows are left
// out of every dashboard figure.
//
// Foreign currency: PayPal pays a purchase in a foreign currency with three rows, linked by the purchase's
// transaction code:
//   the purchase                       USD −105.91   (Typ "PayPal Express-Zahlung", Transaktionscode X)
//   a conversion into that currency    USD +105.91   (Typ "Allgemeine Währungsumrechnung", related code X)
//   a conversion out of euros          EUR  −95.07   (same type, related code X)  ← what it really cost
// The dashboard counts the purchase at its euro cost (keeping its category, tags and place) and leaves both
// conversion rows out. If the euro row is missing, the rows stay as they are and the code is reported, so a
// gap is visible instead of silently dropping spending. Decided with Patrik 2026-10-24.

/** A PayPal row funded from the bank account ("Bankgutschrift auf PayPal-Konto"), in its text or original row. */
export function isPaypalBankFunding(t: { description: string; raw?: unknown }): boolean {
  const hay = (t.description + " " + JSON.stringify(t.raw ?? "")).toLowerCase();
  return hay.includes("bankgutschrift auf paypal");
}

const CONVERSION_TYPES = new Set(["Allgemeine Währungsumrechnung", "General Currency Conversion"]);
const TYPE_KEYS = ["Typ", "Type"];
const RELATED_KEYS = ["Zugehöriger Transaktionscode", "Reference Txn ID"];
const EUR = "EUR";

type Row = { externalId: string | null; currency: string; amount: unknown; raw?: unknown };

function field(raw: unknown, keys: string[]): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const isConversion = (row: Row) => CONVERSION_TYPES.has(field(row.raw, TYPE_KEYS) ?? "");

export function foldPaypalConversions<T extends Row>(rows: T[]): { rows: T[]; unmatched: string[] } {
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
  return {
    rows: rows.filter((row) => !dropped.has(row)).map((row) => replaced.get(row) ?? row),
    unmatched,
  };
}
