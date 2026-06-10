export type NormalizedTxn = {
  externalId: string;
  bookingDate: Date;
  valueDate?: Date | null;
  amount: string; // signed decimal string; negative = money out
  balance?: string | null; // running balance after this txn (bank only)
  currency: string;
  description: string;
  counterparty?: string | null;
  raw: unknown;
};

export type ParsedFile = {
  source: "bank" | "paypal";
  account: { name: string; iban?: string; currency: string };
  transactions: NormalizedTxn[];
};
