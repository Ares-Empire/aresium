// The answer key describes payments, never reader-specific raw records or inferred layouts.
export type Payment = {
  date: string;
  amountCents: number;
  currency: string;
  counterparty: string | null;
  text: string;
};

export type FileCase = {
  version: 1;
  file: string;
  bank: string;
  kind: string;
  situation: string;
  change: string;
  seed: number;
  provenance:
    | { method: "original"; fixture: string; reference: string; sha256: string }
    | { method: "construction"; reason: string }
    | { method: "hand"; reason: string };
  expected:
    | { outcome: "read"; payments: Payment[]; warning?: { skipped: number; reason: string } }
    | { outcome: "refuse"; code: string; reason: string };
  reimport?: { originalIds: string[] };
};

// Independent decimal conversion, shared by the generator and score, with no reader imports.
// Do not round an unexpected sub-cent value into a correct answer.
export function cents(value: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m || /[1-9]/.test((m[3] ?? "").slice(2))) return null;
  const result = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0").slice(0, 2));
  return Number.isSafeInteger(result) ? (m[1] ? -result : result) : null;
}
