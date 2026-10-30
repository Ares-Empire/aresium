import { cardMerchant, merchantKey, type SortingPayment } from "./merchant.js";
import { shopWords } from "./shop-words.js";
import { shopIdentities } from "./shop-identity.js";
import { starterCategory } from "./starter-rules.js";
import { OWN_TRANSFERS, ownTransfers, type TransferPayment } from "./transfers.js";
export type Learned = Readonly<Record<string, string>>;
export type SortResult = { categoryId: string | null; source: "structural" | "learned" | "starter" | null };
// Order: structural (own transfers, ./transfers.ts; the built-in category, whatever the list), then learned (the
// person's own choice), then starter rules. Pass all of the person's payments: the transfer rules look across them.
export function sortPayments(payments: readonly TransferPayment[], options: {
  categories: readonly { id: string }[]; learned?: Learned;
}): SortResult[] {
  const allowed = new Set(options.categories.map((c) => c.id));
  const transfers = ownTransfers(payments);
  const provenTowns = new Set<string>();
  for (const payment of payments) for (const text of [payment.counterparty, payment.description, payment.bookingText]) {
    const card = text ? cardMerchant(text) : null;
    const words = card ? shopWords(card.town) : [];
    if (words.length === 1) provenTowns.add(words[0]);
  }
  const towns = [...provenTowns];
  const keys = payments.map(merchantKey);
  const learned = options.learned ?? {};
  const learnedKeys = Object.keys(learned).sort();
  const distinct = [...new Set([...keys, ...learnedKeys])];
  const shops = shopIdentities(distinct);
  const identities = new Map(distinct.map((key, index) => [key, shops[index]]));
  const rememberedShops = new Map<string, string>();
  for (const key of learnedKeys) {
    const identity = identities.get(key)!;
    // No correction timestamps are available: the lexical first valid key breaks conflicts deterministically.
    if (identity && allowed.has(learned[key]) && !rememberedShops.has(identity)) rememberedShops.set(identity, learned[key]);
  }
  return payments.map((payment, index) => {
    if (transfers[index]) return { categoryId: OWN_TRANSFERS, source: "structural" };
    const key = keys[index];
    // An exact rule, even for a removed category, blocks fallback to somebody else's choice at this shop.
    const remembered = !key ? null : Object.hasOwn(learned, key) ? learned[key]
      : rememberedShops.get(identities.get(key)!);
    if (remembered && allowed.has(remembered)) return { categoryId: remembered, source: "learned" };
    const categoryId = starterCategory(payment, options.categories, towns);
    return { categoryId, source: categoryId ? "starter" : null };
  });
}
export function learn(learned: Learned, payment: SortingPayment, categoryId: string): Learned {
  const key = merchantKey(payment);
  return key ? { ...learned, [key]: categoryId } : { ...learned };
}
