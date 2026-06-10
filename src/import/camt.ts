// Parser for ISO 20022 CAMT bank statements (camt.052 intraday / camt.053 end-of-day).
// VR Bank can export this *if* CAMT is activated for the account; otherwise use CSV/MT940.
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { parseAmount } from "./util.js";
import type { NormalizedTxn, ParsedFile } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // keep IBANs / amounts as strings
});

function arr<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// fast-xml-parser renders <Amt Ccy="EUR">1.23</Amt> as { "@_Ccy": "EUR", "#text": "1.23" }.
function textOf(node: unknown): string {
  if (node && typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)["#text"]);
  }
  return node == null ? "" : String(node);
}

export function parseCamt(xml: string): ParsedFile {
  const doc = parser.parse(xml);
  const root = doc.Document;
  if (!root) throw new Error("not a CAMT document (missing <Document> root)");

  // camt.053 → BkToCstmrStmt/Stmt ; camt.052 → BkToCstmrAcctRpt/Rpt
  const container = root.BkToCstmrStmt || root.BkToCstmrAcctRpt;
  if (!container) throw new Error("unsupported CAMT type (expected camt.052 or camt.053)");
  const statements = arr(container.Stmt || container.Rpt);

  const transactions: NormalizedTxn[] = [];
  let iban: string | undefined;
  let currency = "EUR";

  for (const stmt of statements) {
    iban = iban || stmt?.Acct?.Id?.IBAN;
    currency = stmt?.Acct?.Ccy || currency;

    for (const ntry of arr(stmt.Ntry)) {
      const isDebit = ntry.CdtDbtInd === "DBIT";
      const amount = `${isDebit ? "-" : ""}${parseAmount(textOf(ntry.Amt))}`;
      const ccy =
        ntry.Amt && typeof ntry.Amt === "object" ? ntry.Amt["@_Ccy"] : undefined;

      const bookingDate = new Date(ntry.BookgDt?.Dt || ntry.BookgDt?.DtTm || ntry.ValDt?.Dt);
      const valueDate = ntry.ValDt?.Dt ? new Date(ntry.ValDt.Dt) : null;

      // One entry can bundle several TxDtls (batch booking); use the first for details.
      const tx = arr(ntry.NtryDtls?.TxDtls)[0];
      const remittance =
        arr(tx?.RmtInf?.Ustrd).map(textOf).join(" ").trim() ||
        textOf(ntry.AddtlNtryInf).trim() ||
        "(no description)";

      // Counterparty: for money out it's the creditor, for money in the debtor.
      const creditor = tx?.RltdPties?.Cdtr?.Nm;
      const debtor = tx?.RltdPties?.Dbtr?.Nm;
      const counterpartyRaw = (isDebit ? creditor : debtor) || creditor || debtor;
      const counterparty = counterpartyRaw ? String(counterpartyRaw) : null;

      const ref =
        ntry.AcctSvcrRef || tx?.Refs?.AcctSvcrRef || tx?.Refs?.EndToEndId || tx?.Refs?.TxId;
      const externalId =
        ref && ref !== "NOTPROVIDED"
          ? String(ref)
          : createHash("sha1")
              .update(`${bookingDate.toISOString()}|${amount}|${remittance}|${counterparty ?? ""}`)
              .digest("hex")
              .slice(0, 24);

      transactions.push({
        externalId,
        bookingDate,
        valueDate,
        amount,
        currency: ccy || currency,
        description: remittance,
        counterparty,
        raw: ntry,
      });
    }
  }

  return {
    source: "bank",
    account: { name: iban ? `VR Bank ••${iban.slice(-4)}` : "VR Bank", iban, currency },
    transactions,
  };
}
