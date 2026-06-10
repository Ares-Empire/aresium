export type NormalizedTxn = {
  externalId: string;
  bookingDate: Date;
  valueDate?: Date | null;
  amount: string; // signed decimal string; negative = money out
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
