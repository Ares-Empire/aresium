// CAMT (ISO 20022 XML) from any bank: camt.052 (account report, intraday), camt.053 (statement) and camt.054
// (debit/credit notification), in the schema versions German banks use (.001.02 up to .001.08 and later;
// from .001.04 names sit under <Pty>, the status under <Sts><Cd>, the BIC in <BICFI>).
// Spec: ISO 20022 message definitions (iso20022.org, "Bank-to-Customer Cash Management"), and the German
// banking industry's rules for them, DFÜ-Abkommen Anlage 3 (ebics.de, "Spezifikation der Datenformate").
//
// One payment per <Ntry> (a batch booking counts once, with its total). Entries not booked yet (status PDNG,
// INFO) are skipped: they come back booked with other details and would count twice.
//
// Ids: the bank's own reference (AcctSvcrRef), else a hash of the booking fields with its occurrence number.
// Files from VR banks (and files that do not name their bank) keep the id the server's VR CAMT reader gave
// (src/import/camt.ts): AcctSvcrRef, then EndToEndId or TxId, then its hash; only repeats in one file differ.
// Other banks do not use EndToEndId as the id: the payer sets it, and some reuse one every month.
import { XMLParser } from "fast-xml-parser";
import { parseAmount } from "../../import/util.js";
import { hashId, withOccurrences, type IdCandidate } from "./ids.js";
import { accountName, BankFileError } from "./table.js";
import { addAmounts, cleanText, negate, parseAmountStrict, sameAmount } from "./values.js";
import type { BankAccount, BankFile, BankTxn } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // keep IBANs and amounts as strings
  removeNSPrefix: true, // <ns2:Document> and friends
});

type Node = Record<string, any>; // parsed XML: any shape

function arr<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// <Amt Ccy="EUR">1.23</Amt> arrives as { "@_Ccy": "EUR", "#text": "1.23" }.
function textOf(node: unknown): string {
  if (node && typeof node === "object" && "#text" in (node as Node)) return String((node as Node)["#text"]);
  return node == null || typeof node === "object" ? "" : String(node);
}

const dateOnly = (value: unknown) => {
  const v = textOf(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(0, 10)}T00:00:00.000Z` : null;
};

// A party's name in .001.02 (<Cdtr><Nm>) and from .001.04 on (<Cdtr><Pty><Nm>).
const nameOf = (party: Node | undefined): string => cleanText(textOf(party?.Nm) || textOf(party?.Pty?.Nm));
const ibanOf = (account: Node | undefined): string => textOf(account?.Id?.IBAN).replace(/\s/g, "");

// A transaction's text: its unstructured lines, else its structured reference, else its additional information.
const remittance = (tx: Node | undefined): string =>
  cleanText(...arr(tx?.RmtInf?.Ustrd).map(textOf))
  || cleanText(...arr(tx?.RmtInf?.Strd).map((s: Node) => textOf(s?.CdtrRefInf?.Ref)))
  || cleanText(textOf(tx?.AddtlTxInf));

// A batch booking's text: its transactions' different texts, the first three of them.
function batchText(texts: string[]): string {
  const distinct = [...new Set(texts.filter(Boolean))];
  return distinct.length > 3 ? `${distinct.slice(0, 3).join(" / ")} / …` : distinct.join(" / ");
}

function signedAmount(node: Node): string | null {
  const amount = parseAmountStrict(textOf(node.Amt), "en");
  if (!amount) return null;
  return node.CdtDbtInd === "DBIT" ? negate(amount) : amount;
}

// The id the server's VR CAMT reader gives this entry (src/import/camt.ts, kept byte for byte).
function vrCamtId(ntry: Node): IdCandidate {
  const isDebit = ntry.CdtDbtInd === "DBIT";
  const amount = `${isDebit ? "-" : ""}${parseAmount(textOf(ntry.Amt))}`;
  const bookingDate = new Date(ntry.BookgDt?.Dt || ntry.BookgDt?.DtTm || ntry.ValDt?.Dt);
  const tx = arr(ntry.NtryDtls?.TxDtls)[0] as Node | undefined;
  const remittance = arr(tx?.RmtInf?.Ustrd).map(textOf).join(" ").trim() || textOf(ntry.AddtlNtryInf).trim() || "(no description)";
  const creditor = tx?.RltdPties?.Cdtr?.Nm;
  const debtor = tx?.RltdPties?.Dbtr?.Nm;
  const counterpartyRaw = (isDebit ? creditor : debtor) || creditor || debtor;
  const counterparty = counterpartyRaw ? String(counterpartyRaw) : null;
  const time = bookingDate.getTime();
  const fields = `${isNaN(time) ? "Invalid Date" : bookingDate.toISOString()}|${amount}|${remittance}|${counterparty ?? ""}`;
  const ref = ntry.AcctSvcrRef || tx?.Refs?.AcctSvcrRef || tx?.Refs?.EndToEndId || tx?.Refs?.TxId;
  return { id: ref && ref !== "NOTPROVIDED" ? String(ref) : hashId(fields), fields };
}

// VR banks (Volksbanken, Raiffeisenbanken) have BICs starting with GENO and bank codes whose fourth digit is 6
// or 9 (the cooperative banks' group in the German bank code system).
function isVrBank(iban: string, bic: string): boolean {
  if (!iban && !bic) return true;
  if (bic.toUpperCase().startsWith("GENO")) return true;
  return /^DE\d{2}\d{3}[69]/.test(iban);
}

const PENDING = new Set(["PDNG", "INFO", "FUTR"]);
const statusOf = (ntry: Node) => textOf(ntry.Sts?.Cd ?? ntry.Sts).trim().toUpperCase();

// Opening and closing booked balance of a statement, as signed amounts.
function balances(stmt: Node): { opening?: string; closing?: string } {
  const out: { opening?: string; closing?: string } = {};
  for (const bal of arr(stmt.Bal) as Node[]) {
    const code = textOf(bal?.Tp?.CdOrPrtry?.Cd).toUpperCase();
    const amount = signedAmount(bal);
    if (!amount) continue;
    if ((code === "OPBD" || code === "PRCD") && out.opening === undefined) out.opening = amount;
    if (code === "CLBD") out.closing = amount;
  }
  return out;
}

export function readCamt(xml: string): BankFile {
  let doc: Node;
  try { doc = parser.parse(xml); } catch { throw new BankFileError("camt", "This XML file could not be read."); }
  const root = doc.Document;
  const container = root?.BkToCstmrStmt ?? root?.BkToCstmrAcctRpt ?? root?.BkToCstmrDbtCdtNtfctn;
  if (!container) throw new BankFileError("camt", "This XML file is not a CAMT bank statement (camt.052, .053 or .054).");
  const statements = arr(container.Stmt ?? container.Rpt ?? container.Ntfctn) as Node[];

  const transactions: Omit<BankTxn, "externalId">[] = [];
  const candidates: IdCandidate[] = [];
  let iban = "", bic = "", bankName = "", currency = "EUR", skipped = 0;
  for (const stmt of statements) {
    iban ||= ibanOf(stmt.Acct);
    bic ||= textOf(stmt.Acct?.Svcr?.FinInstnId?.BIC ?? stmt.Acct?.Svcr?.FinInstnId?.BICFI);
    bankName ||= cleanText(textOf(stmt.Acct?.Svcr?.FinInstnId?.Nm));
    currency = textOf(stmt.Acct?.Ccy) || currency;
  }
  const vr = isVrBank(iban, bic);

  for (const stmt of statements) {
    const { opening, closing } = balances(stmt);
    const start = transactions.length;
    for (const ntry of arr(stmt.Ntry) as Node[]) {
      const amount = signedAmount(ntry);
      const bookingDate = dateOnly(ntry.BookgDt?.Dt ?? ntry.BookgDt?.DtTm) ?? dateOnly(ntry.ValDt?.Dt ?? ntry.ValDt?.DtTm);
      if (PENDING.has(statusOf(ntry)) || !amount || !bookingDate) { skipped++; continue; }
      const out = amount.startsWith("-");
      const details = arr(ntry.NtryDtls).flatMap((d: Node) => arr(d?.TxDtls)) as Node[];
      const tx = details[0];
      const parties = tx?.RltdPties ?? {};
      const creditor = nameOf(parties.Cdtr) || nameOf(parties.UltmtCdtr);
      const debtor = nameOf(parties.Dbtr) || nameOf(parties.UltmtDbtr);
      const counterparty = (out ? creditor || debtor : debtor || creditor) || null;
      const counterpartyIban = ibanOf(out ? parties.CdtrAcct : parties.DbtrAcct);
      const description = batchText(details.map(remittance)) || cleanText(textOf(ntry.AddtlNtryInf)) || "(no description)";
      const ccy = (ntry.Amt && typeof ntry.Amt === "object" ? ntry.Amt["@_Ccy"] : undefined) || currency;
      transactions.push({
        bookingDate,
        valueDate: dateOnly(ntry.ValDt?.Dt ?? ntry.ValDt?.DtTm),
        amount,
        currency: ccy,
        description,
        counterparty,
        raw: ntry,
      });
      if (vr) candidates.push(vrCamtId(ntry));
      else {
        const ref = textOf(ntry.AcctSvcrRef) || textOf(tx?.Refs?.AcctSvcrRef);
        const fields = [bookingDate.slice(0, 10), amount, description, counterparty ?? "", counterpartyIban,
          textOf(tx?.Refs?.EndToEndId)].join("|");
        candidates.push({ id: ref && ref !== "NOTPROVIDED" ? ref : hashId(fields), fields });
      }
    }
    // Balance after each booking, from the opening balance, when the bookings run in date order and add up to
    // the closing balance (otherwise none is given rather than a wrong one).
    const own = transactions.slice(start);
    if (opening !== undefined && own.length > 0 && own.every((t, i) => i === 0 || own[i - 1].bookingDate <= t.bookingDate)) {
      let running = opening;
      const after = own.map((t) => (running = addAmounts(running, t.amount)));
      if (closing === undefined || sameAmount(running, closing)) own.forEach((t, i) => { t.balance = after[i]; });
    }
  }

  const ids = withOccurrences(candidates);
  const account: BankAccount = { name: accountName(bankName || "Bank", iban || undefined), currency };
  if (iban) account.iban = iban;
  return {
    format: "camt",
    account,
    transactions: transactions.map((t, i) => ({ externalId: ids[i], ...t })),
    skipped,
  };
}
