// Extracts city + country from VR Bank card-payment descriptions, which embed the
// place either as "<merchant> DEU Hamburg EUR 5,90 Umsatz vom ..." or as
// ".../München/DE 04.02.2026 ...".
import { prisma } from "../lib/db.js";

const C3: Record<string, string> = {
  DEU: "DE", AUT: "AT", ESP: "ES", ITA: "IT", FRA: "FR", CHE: "CH", NLD: "NL",
  BEL: "BE", GBR: "GB", USA: "US", POL: "PL", CZE: "CZ", DNK: "DK", SWE: "SE",
  NOR: "NO", PRT: "PT", GRC: "GR", HRV: "HR", TUR: "TR", LUX: "LU", IRL: "IE",
  HUN: "HU", SVN: "SI", SVK: "SK",
};
const C2 = new Set(Object.values(C3));

export type Loc = { city?: string; country?: string };

export function extractLocation(text: string): Loc {
  const t = text.replace(/\s+/g, " ").trim();
  // Format A: "... DEU Hamburg EUR ..."
  let m = t.match(/\b([A-Z]{3})\s+(.+?)\s+EUR\b/);
  if (m && C3[m[1]]) return { country: C3[m[1]], city: cleanCity(m[2]) };
  // Format B: ".../München/DE ..." (city is the token before the 2-letter country)
  m = t.match(/\/([^/]{2,40})\/([A-Z]{2})(?:[/\s]|$)/);
  if (m && C2.has(m[2])) return { country: m[2], city: cleanCity(m[1]) };
  return {};
}

function cleanCity(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[._]+$/g, "").trim();
}

const stripDiacritics = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const HOME_TOKENS: string[] = []; // see config/personal.json

// A transaction is "at home" if it has no location (online/direct debit) or is in
// one of the home cities. Anything in a foreign country, or a different German city, is "away".
export function isHome(loc: Loc): boolean {
  if (!loc.country) return true;
  if (loc.country !== "DE") return false;
  const c = stripDiacritics(loc.city ?? "");
  return HOME_TOKENS.some((tok) => c.includes(tok));
}

export async function applyLocations(): Promise<number> {
  const txns = await prisma.transaction.findMany({
    where: { source: "bank" },
    select: { id: true, description: true },
  });
  let tagged = 0;
  for (const t of txns) {
    const loc = extractLocation(t.description);
    if (loc.country) {
      await prisma.transaction.update({
        where: { id: t.id },
        data: { city: loc.city ?? null, country: loc.country },
      });
      tagged++;
    }
  }
  return tagged;
}
