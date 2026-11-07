import { XMLParser } from "fast-xml-parser";
import { decodeBankFile } from "./decode.js";
import { BankFileError } from "./table.js";
import type { BankFile, BankTxn } from "./types.js";
import { isZip } from "./zip.js";

const noBank = (): never => { throw new BankFileError("zipNoBankFile", "The ZIP archive contains no CAMT, MT940 or CSV bank files."); };
const accounts = (): never => { throw new BankFileError("zipAccounts", "The ZIP archive contains different accounts or its files cannot be confirmed as one account. Export one account at a time."); };
const layout = (): never => { throw new BankFileError("zipLayout", "A bank file inside this ZIP needs its columns confirmed. Import that file separately first."); };

export function archiveBankTexts(files: Map<string, Uint8Array>, isBank: (text: string) => boolean): string[] {
  const texts: string[] = [];
  for (const [name, bytes] of files) {
    // Never descend into another ZIP, including a workbook, even if it was renamed.
    if (isZip(bytes) || /\.(zip|xlsx|xls)$/i.test(name)) continue;
    const text = decodeBankFile(bytes);
    if (isBank(text) || /\.(csv|sta|mta|mt940)$/i.test(name)) texts.push(text);
  }
  if (!texts.length) return noBank();
  return texts;
}

// A single CAMT/MT940 member can itself contain several statements. Check every account in it before the
// existing single-account reader runs, without changing standalone imports or their ids.
function memberAccounts(text: string): string[] {
  if (text.trimStart().startsWith("<")) {
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true });
    let root;
    try { root = parser.parse(text).Document; }
    catch { throw new BankFileError("camt", "This XML file could not be read."); }
    const container = root?.BkToCstmrStmt ?? root?.BkToCstmrAcctRpt ?? root?.BkToCstmrDbtCdtNtfctn;
    const statements = container?.Stmt ?? container?.Rpt ?? container?.Ntfctn ?? [];
    return [statements].flat().map((s) => String(s.Acct?.Id?.IBAN ?? s.Acct?.Id?.Othr?.Id ?? "").replace(/\s/g, "").toUpperCase());
  }
  return [...text.matchAll(/^:25:(.+)$/gm)].map((m) => m[1].trim().replace(/\s/g, "").toUpperCase());
}

export function readArchive(texts: string[], read: (text: string) => BankFile): BankFile {
  const files = texts.map((text) => {
    const ids = memberAccounts(text);
    if (new Set(ids).size > 1) return accounts();
    return { file: read(text), own: ids[0] };
  });
  if (files.length === 1) return { ...files[0].file, transactions: [...files[0].file.transactions].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)) };
  if (files.some(({ file }) => file.needsLayout)) return layout();
  const identities = files.map(({ file, own }) => file.account?.iban?.replace(/\s/g, "").toUpperCase() || own);
  if (identities.some((id) => !id) || new Set(identities).size !== 1
    || new Set(files.map(({ file }) => file.account?.currency ?? "EUR")).size !== 1) return accounts();
  const payments = new Map<string, BankTxn>();
  for (const { file } of files) for (const txn of file.transactions) {
    const previous = payments.get(txn.externalId);
    if (previous) {
      if (previous.bookingDate !== txn.bookingDate || previous.amount !== txn.amount || previous.currency !== txn.currency
        || previous.description !== txn.description || previous.counterparty !== txn.counterparty) {
        throw new BankFileError("unknown", "Two statements give different payments with the same id. Import the statements separately and check them.");
      }
    } else payments.set(txn.externalId, txn);
  }
  return { ...files[0].file, transactions: [...payments.values()].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)),
    skipped: files.reduce((n, { file }) => n + (file.skipped ?? 0), 0) };
}
