// The register's signed data, as German receipts print it in a QR code (Kassensicherungsverordnung § 6; the cash
// register's TSE, BSI TR-03153). Format from the tax administration's interface for cash registers:
//   DSFinV-K version 2.4 (15 Dec 2023), Anhang I "Definition „Art“ und „Daten“ des Vorgangs; QR-Code",
//   section 1 (processType "Kassenbeleg-V1") and section 2 "Definition des QR-Codes für maschinell prüfbare
//   Kassenbelege"; published by the Bundeszentralamt für Steuern:
//   https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv_node.html
//   (dsfinv_k_v_2_4.zip → 20231215_DSFinV_K_2_4.pdf, pages 112–124).
//
// The code is twelve fields joined by ";":
//   V0;<register serial>;<processType>;<processData>;<transaction no>;<signature counter>;<start time>;<log time>;
//   <signature algorithm>;<log time format>;<signature>;<public key>
// e.g. V0;AMA-2642;Kassenbeleg-V1;Beleg^4.05_3.00_0.00_0.00_0.00^7.05:Bar;13;44131;2019-11-22T11:29:48.000Z;
//      2019-11-22T11:29:49.000Z;ecdsa-plain-SHA384;unixTime;K8zs…;BBXN…
// processData of a "Kassenbeleg-V1" is <kind>^<gross amounts>^<payments>:
//   - kind: "Beleg" for a sale (others: AVTraining, AVBelegabbruch, AVRechnung, …, which are not purchases);
//   - gross amounts in EUR per VAT rate, always five, joined by "_": standard, reduced, two average rates, 0 %;
//   - payments joined by "_", each <amount>:<"Bar" | "Unbar">[:<ISO currency, when not EUR>]; zero payments left out.
// Amounts have a decimal point and two decimals; negatives a leading "-". Times are the TSE's, in UTC
// ("YYYY-MM-DDThh:mm:ss.fffZ"). The total is the sum of the gross amounts (they "must match the printed receipt").
import { addAmounts, parseAmountStrict } from "../readers/values.js";

export type RegisterCode = {
  /** Gross total in EUR: the sum of the five amounts per VAT rate. */
  total: number;
  /** "cash" when only Bar was paid, "card" when only Unbar, null when both or neither. */
  method: "cash" | "card" | null;
  /** The receipt's day and time in German time (the TSE writes UTC). */
  date: string | null;
  time: string | null;
};

const amount = (text: string): string | null => (/^-?\d+\.\d{2}$/.test(text) ? parseAmountStrict(text, "en") : null);

/** The register's data from a scanned code, or null when the code is something else (a loyalty link, a barcode). */
export function readRegisterCode(code: string): RegisterCode | null {
  if (typeof code !== "string") return null;
  const fields = code.trim().split(";");
  if (fields.length < 8 || fields[0] !== "V0" || fields[2] !== "Kassenbeleg-V1") return null;
  const [kind, gross, payments = ""] = fields[3].split("^");
  if (kind !== "Beleg") return null;
  const perRate = (gross ?? "").split("_").map(amount);
  if (perRate.length !== 5) return null;
  let total = "0.00";
  for (const a of perRate) {
    if (a === null) return null;
    total = addAmounts(total, a);
  }

  let cash = false, card = false;
  for (const payment of payments ? payments.split("_") : []) {
    const [value, how] = payment.split(":");
    const paid = amount(value ?? "");
    if (paid === null || (how !== "Bar" && how !== "Unbar")) return null;
    if (Number(paid) <= 0) continue; // a refund or a top-up swap does not say how the purchase was paid
    if (how === "Bar") cash = true; else card = true;
  }
  const when = germanTime(fields[7]) ?? germanTime(fields[6]);
  return { total: Number(total), method: cash === card ? null : cash ? "cash" : "card", date: when?.date ?? null, time: when?.time ?? null };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The last Sunday of a month (1–12), as a day of the month. */
const lastSunday = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
};

/**
 * A TSE time ("2026-10-27T13:32:05.000Z") in German time: CET, and CEST from the last Sunday of March to the last
 * Sunday of October, switching at 01:00 UTC (EU rule since 1996). Without the "Z" the time is taken as written.
 */
export function germanTime(value: string | undefined): { date: string; time: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z)?$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
  let utc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(utc) || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  if (m[7]) {
    const summerStart = Date.UTC(y, 2, lastSunday(y, 3), 1);
    const summerEnd = Date.UTC(y, 9, lastSunday(y, 10), 1);
    utc += (utc >= summerStart && utc < summerEnd ? 2 : 1) * 3_600_000;
  }
  const t = new Date(utc);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
}
