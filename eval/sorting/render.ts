import { readdir, readFile } from "node:fs/promises";
import { readBankText, detectBankFile } from "../../src/engine/readers/read.js";
import { decodeBankFile } from "../../src/engine/readers/decode.js";
import type { CsvLayout, BankFile } from "../../src/engine/readers/types.js";
import type { TransferPayment } from "../../src/engine/sorting/transfers.js";
import { accepted, hash, type Answer } from "./model.js";
export const IBANS = ["DE09000000000000000001", "DE79000000000000000002", "DE52000000000000000003"];
export const DELIVERY_SERVICES: readonly string[] = ["Lieferando", "Wolt", "Uber Eats"];
export const SERVICES = ["direct", "SUMUP *", "ZETTLE_", "iZ *", "SQ *", "PAYPAL *", "Klarna", "Stripe", "Adyen", "NEXI", "Worldline", "AMZN Mktp", ...DELIVERY_SERVICES];
export type RenderInput = { name: string; purpose?: string; amount: number; town?: string; booking?: string; service?: string; foreign?: boolean;
  answer?: Answer; pharmacy?: boolean };
export function serviceAllowed(service: string, input: Pick<RenderInput, "answer" | "pharmacy">): boolean {
  if (!DELIVERY_SERVICES.includes(service)) return true;
  const categories = accepted(input.answer ?? {});
  if (categories.some((category) => category === "eating-out" || category === "coffee-snacks")) return true;
  return service !== "Lieferando" && (categories.includes("groceries") || categories.includes("health") && input.pharmacy === true);
}
export function chooseService(input: RenderInput, index: number, paypalExport = false): string {
  if (paypalExport) return "PayPal export";
  const original = input.service ?? (input.purpose ? "direct" : SERVICES[index % SERVICES.length]);
  if (serviceAllowed(original, input)) return original;
  // Preserve the original seeded selection for every valid case; only impossible wrappers are replaced.
  const remaining = SERVICES.filter((service) => serviceAllowed(service, input));
  return remaining[index % remaining.length];
}
type Template = { id: string; layout: CsvLayout };
let templates: Template[] | undefined;
export async function layouts(): Promise<Template[]> {
  if (templates) return templates;
  const root = new URL("../../src/engine/fixtures/banks/", import.meta.url);
  templates = [];
  for (const name of (await readdir(root)).filter((s) => s.endsWith(".expected.json")).sort()) {
    const file = JSON.parse(await readFile(new URL(name, root), "utf8")) as BankFile;
    let layout = file.layout;
    if (!layout && file.format === "csv" && file.bank) {
      const source = await readFile(new URL(name.replace(".expected.json", ""), root));
      const detected = detectBankFile(decodeBankFile(source));
      if (detected.format === "csv") layout = detected.layout ?? undefined;
    }
    if (layout) templates.push({ id: name.replace(".expected.json", ""), layout });
  }
  return templates;
}
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function render(input: RenderInput, index: number, forceLayout?: string): Promise<{ payment: TransferPayment; rendering: { layout: string; variation: string; service: string; line: string } }> {
  const available = await layouts();
  const choices = [...available.map((t) => t.id), "paypal-de", "paypal-en", "camt053", "mt940"];
  const layoutId = forceLayout ?? choices[index % choices.length];
  const variation = index % 8;
  let name = input.name;
  if (variation === 1 || variation === 5) name = name.toUpperCase();
  if (variation === 2) name = name.replace(/ä/gi, "AE").replace(/ö/gi, "OE").replace(/ü/gi, "UE").replace(/ß/g, "SS");
  if (variation === 3) name = name.replace(/ä/gi, "A").replace(/ö/gi, "O").replace(/ü/gi, "U").replace(/ß/g, "SS");
  if (variation === 4 || variation === 5) name = name.slice(0, 22 + index % 6);
  const paypalExport = layoutId.startsWith("paypal-");
  const service = chooseService(input, index, paypalExport);
  // A generic marketplace descriptor hides the item; the generator must mark these unclear/personal.
  if (!paypalExport && service === "AMZN Mktp") name = "AMZN Mktp DE";
  else if (!paypalExport && service !== "direct") name = `${service}${/[\s_*]$/.test(service) ? "" : " *"}${name}`;
  const town = input.town ?? "Musterstadt";
  const kind = input.booking ?? (input.amount > 0 ? "Gutschrift" : ["Kartenzahlung", "Lastschrift", "SEPA-Überweisung", "Dauerauftrag", "girocard", "VISA Debit"][index % 6]);
  const date = `2026-${String(1 + index % 9).padStart(2, "0")}-${String(1 + index % 27).padStart(2, "0")}`;
  const printedDate = date.split("-").reverse().join(".");
  let purpose = input.purpose ?? (variation === 6 ? `${name} Filiale ${101 + index % 900} Terminal ${700000 + index}`
    : variation === 7 ? `${name} ${town} DE Karte ****1234 ${printedDate}` : `${name} ${town} DE`);
  if (input.foreign) purpose = `${name}  GBR  London  GBP  ${(Math.abs(input.amount) * 0.86).toFixed(2).replace(".", ",")} Kurs 0,8600 Umsatz vom ${printedDate}`;
  const otherIban = IBANS[2], ownIban = IBANS[0];
  let text: string;
  if (layoutId.startsWith("paypal-")) {
    const de = layoutId === "paypal-de";
    const header = de ? ["Datum", "Uhrzeit", "Name", "Typ", "Währung", "Netto", "Transaktionscode", "Auswirkung auf Guthaben"]
      : ["Date", "Time", "Name", "Type", "Currency", "Net", "Transaction ID", "Balance Impact"];
    // PayPal's reader uses the name as description, not an invented free-text purpose column.
    const type = input.booking ?? (de ? (input.amount > 0 ? "Allgemeine Zahlung" : "Zahlung im Einzugsverfahren") : "General Payment");
    text = [header, [printedDate, "10:15:00", name, type, "EUR", input.amount.toFixed(2).replace(".", de ? "," : "."), `FICT-${index}`, "Debit"]].map((r) => r.map(quote).join(",")).join("\n");
  } else if (layoutId === "camt053") {
    const party = input.amount < 0 ? "Cdtr" : "Dbtr";
    text = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Id>FICT</Id><Acct><Id><IBAN>${ownIban}</IBAN></Id><Ccy>EUR</Ccy><Svcr><FinInstnId><Nm>Fiktivbank</Nm><BICFI>FICTDEFFXXX</BICFI></FinInstnId></Svcr></Acct><Ntry><Amt Ccy="EUR">${Math.abs(input.amount).toFixed(2)}</Amt><CdtDbtInd>${input.amount < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>${date}</Dt></BookgDt><AcctSvcrRef>FICT-${index}</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><${party}><Pty><Nm>${xml(name)}</Nm></Pty></${party}><${party}Acct><Id><IBAN>${otherIban}</IBAN></Id></${party}Acct></RltdPties><RmtInf><Ustrd>${xml(purpose)}</Ustrd></RmtInf></TxDtls></NtryDtls><AddtlNtryInf>${xml(kind)}</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`;
  } else if (layoutId === "mt940") {
    const cut = (value: string, start: number) => (value.match(/.{1,27}/gu) ?? []).map((part, i) => `?${start + i}${part}`).join("");
    text = `:20:FICT\n:25:${ownIban}\n:28C:00001/001\n:60F:C260101EUR0,00\n:61:${date.slice(2).replace(/-/g, "")}${input.amount < 0 ? "D" : "C"}${Math.abs(input.amount).toFixed(2).replace(".", ",")}NTRFNONREF\n:86:105?00${kind}${cut(purpose, 20)}?31${otherIban}${cut(name, 32)}\n-\n`;
  } else {
    const template = available.find((t) => t.id === layoutId);
    if (!template) throw new Error("Unknown rendering layout");
    const l = template.layout, c = l.columns;
    const row = new Array<string>(l.columnCount ?? l.header.length).fill("");
    const set = (column: number | undefined, value: string) => { if (column !== undefined) row[column] = value; };
    const formattedDate = l.dateFormat === "YYYY-MM-DD" ? date : l.dateFormat === "DD.MM.YY" ? printedDate.slice(0, 6) + printedDate.slice(8)
      : l.dateFormat === "DD/MM/YYYY" ? printedDate.replace(/\./g, "/") : l.dateFormat === "MM/DD/YYYY" ? `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}` : printedDate;
    const number = (n: number) => n.toFixed(2).replace(".", l.numberFormat === "de" ? "," : ".");
    set(c.date, formattedDate); set(c.valueDate, formattedDate);
    set(c.currency, "EUR"); if (c.status !== c.date && c.status !== c.valueDate) set(c.status, l.keepStatus?.[0] ?? "Gebucht");
    set(c.amount, number(c.sign !== undefined ? Math.abs(input.amount) : l.invertSign ? -input.amount : input.amount));
    set(c.debit, input.amount < 0 ? number(Math.abs(input.amount)) : "0");
    set(c.credit, input.amount > 0 ? number(input.amount) : "0");
    set(c.sign, input.amount < 0 ? "S" : "H");
    set(c.iban, otherIban); set(c.accountIban, ownIban); set(c.reference, `FICT-${index}`);
    set(c.kind, kind);
    const party = input.amount < 0 ? c.payee : c.payer;
    set(party ?? c.counterparty?.[0], name);
    if (l.labelledText) purpose = `Empfänger: ${name} Kto/IBAN: ${otherIban} Buchungstext: ${purpose}`;
    set(c.text?.[0], purpose);
    // Card statements often have only one text/counterparty column.
    if (!c.text?.length && (c.counterparty?.length || party !== undefined)) set(party ?? c.counterparty?.[0], input.purpose ? `${name} ${input.purpose}` : input.foreign ? purpose : name);
    text = [...(l.header.length ? [l.header] : []), row].map((r) => r.map(quote).join(l.separator)).join("\n");
  }
  const parsed = readBankText(text);
  if (parsed.transactions.length !== 1) throw new Error(`Rendering failed for ${layoutId}: expected one payment`);
  const p = parsed.transactions[0];
  if (Number(p.amount).toFixed(2) !== input.amount.toFixed(2)) throw new Error(`Rendering changed amount for ${layoutId}`);
  return { payment: { counterparty: p.counterparty, description: p.description, amount: Number(p.amount), currency: p.currency,
    date: p.bookingDate.slice(0, 10), externalId: p.externalId, source: parsed.format === "paypal" ? "paypal" : "bank",
    account: parsed.format === "paypal" ? "fict-paypal" : "fict-giro", accountIban: parsed.format === "paypal" ? null : parsed.account?.iban ?? ownIban,
    ...(p.counterpartyIban ? { counterpartyIban: p.counterpartyIban } : {}), raw: p.raw },
    rendering: { layout: layoutId, variation: ["original", "uppercase", "umlaut-expanded", "umlaut-dropped", "cut-22-27", "uppercase-cut", "branch-terminal", "town-card-date"][variation], service,
      line: [p.counterparty, p.description].filter(Boolean).join(" | ") },
  };
}
export const opaqueId = (seed: string) => hash(`aresium-sorting-v1:${seed}`).slice(0, 20);
