export type SortingPayment = { counterparty?: string | null; description?: string; bookingText?: string };

// A finite suffix list avoids stripping arbitrary words from independent shop names.
// Unknown towns stay in the key; adding more suffixes is deliberately conservative.
const citySuffix = /(?:[\s,/*-]+)(?:münchen|muenchen|berlin|hamburg|köln|koeln|frankfurt(?: am main)?|stuttgart|düsseldorf|duesseldorf|leipzig|dresden|hannover|nürnberg|nuernberg|bremen|heidelberg|mannheim|karlsruhe|augsburg|bonn|essen|dortmund)(?:\s+(?:de|deu|deutschland))?\s*$/u;

/** A correction groups merchant identities, not individual bookings. Empty keys are never learned. */
export function merchantKey(payment: SortingPayment): string {
  let text = (payment.counterparty?.trim() || payment.description || payment.bookingText || "").toLowerCase().normalize("NFC");
  const processor = /^paypal(?:\s|$|\()/u;
  if (processor.test(text)) {
    const details = (payment.description ?? payment.bookingText ?? "").toLowerCase().normalize("NFC");
    const seller = text.match(/ihr einkauf bei\s+(.+?)(?:\.\s|$)/u)?.[1]
      ?? details.match(/ihr einkauf bei\s+(.+?)(?:\.\s|$)/u)?.[1]
      ?? text.match(/^paypal\s*\*\s*(.+)/u)?.[1]
      ?? details.match(/^paypal\s*\*\s*(.+)/u)?.[1];
    // A processor alone is not a merchant identity. Do not merge unrelated sellers.
    if (!seller) return "";
    text = seller;
  }
  // Prefer a PayPal seller when one is present; a bare processor remains a processor.
  text = text.replace(/^paypal\s*\*\s*/u, "");
  text = text.replace(/^(?:(?:sepa[ -])?(?:basis[ -]?)?lastschrift|kartenzahlung|debitkartenzahlung|kaufumsatz|sepa überweisung)\s*[:/-]?\s*/u, "");
  // Booking metadata starts here, including creditor/mandate ids in debit descriptions.
  text = text.split(/\b(?:eref|mref|cred|iban|bic|mandatsreferenz|gläubiger-id|glaeubiger-id|kundenreferenz)\s*[:+]/u)[0];
  text = text.replace(/\b(?:karte(?:nnr|nnummer)?|karten-nr|card(?: number)?|terminal|beleg|trace|folge-nr)\.?\s*[:#-]?\s*[\d*x.-]+/gu, " ");
  text = text.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/gu, " ");
  text = text.replace(/\b(?:filiale|fil\.?|markt-nr\.?|branch)\s*[:#-]?\s*\d+\b/gu, " ");
  text = text.replace(/\d{5,}|\b\d{3,}\b|\bx{2,}\d*\b|\*{2,}\d*/gu, " ");
  text = text.replace(/^((?:rewe(?:\s+markt)?|dm(?:-drogerie\s*markt)?))\s+\d+\b/u, "$1 ");
  text = text.replace(/\bsagt\s+danke\b|\bdankt\b/gu, " ");
  text = text.replace(/\bgmbh\s*(?:&|\+|und)\s*co\.?\s*kg\b/gu, " ");
  text = text.replace(/\b(?:gmbh|aktiengesellschaft|ag|se|kg|ohg)\b|\be\s*\.\s*k\b\s*\.?/gu, " ");
  text = text.replace(/\b(?:und\s+)?co\b/gu, " ").replace(/&/gu, " ");
  text = text.replace(/[\/;,|]+/gu, " ").replace(/\s+/gu, " ").replace(/[\s.*#-]+$/gu, "").trim();
  // A city can be followed by another suffix (country, whitespace left by metadata).
  text = text.replace(citySuffix, "").replace(/[\s.*#-]+$/gu, "").trim();
  return text;
}
