// The phone uses the server's parser and transaction codes, with its own counterparty fix on top.
// Keep the server's email fallback unchanged until its own import path is migrated and checked.
import { parsePaypalCsv as serverPaypal } from "../../import/paypal-csv.js";
import type { ParsedFile } from "../../import/types.js";
import { pick } from "../../import/util.js";

export function parsePaypalCsv(text: string): ParsedFile {
  const file = serverPaypal(text);
  return {
    ...file,
    transactions: file.transactions.map((payment) => {
      const raw = payment.raw as Record<string, string>;
      if (pick(raw, ["Name"])) return payment;
      // No Name means PayPal's own entry: the sender email can be the person's own address.
      return { ...payment, counterparty: null, description: pick(raw, ["Type", "Typ", "Beschreibung"]) ?? payment.description };
    }),
  };
}
