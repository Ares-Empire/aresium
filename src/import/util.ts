// Number/date helpers shared by the CSV + CAMT parsers.

// Normalises "1.234,56" (de), "1,234.56" (en), "-42,99", "42.99" → "1234.56" etc.
export function parseAmount(input: string): string {
  let v = input.trim().replace(/\s/g, "").replace(/[€$]/g, "");
  if (v.includes(",") && v.includes(".")) {
    // whichever separator comes last is the decimal point
    if (v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
  } else if (v.includes(",")) {
    v = v.replace(",", ".");
  }
  return v || "0";
}

function fullYear(y: string): number {
  const n = parseInt(y, 10);
  return n < 100 ? 2000 + n : n;
}

// Handles YYYY-MM-DD, DD.MM.YYYY (de), MM/DD/YYYY (PayPal en).
export function parseDateFlexible(input: string): Date {
  const t = input.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(`${t.slice(0, 10)}T00:00:00Z`);
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return new Date(Date.UTC(fullYear(m[3]), +m[2] - 1, +m[1]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return new Date(Date.UTC(fullYear(m[3]), +m[1] - 1, +m[2]));
  const fallback = new Date(t);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

// Looks up the first present, non-empty column from a list of candidate names.
export function pick(row: Record<string, string>, candidates: string[]): string | undefined {
  for (const c of candidates) if (row[c] !== undefined && row[c].trim() !== "") return row[c].trim();
  return undefined;
}
