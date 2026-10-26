import { merchantKey, type SortingPayment } from "./merchant.js";
import { starterCategory } from "./starter-rules.js";
export type Learned = Readonly<Record<string, string>>;
export type SortResult = { categoryId: string | null; source: "learned" | "starter" | null };
export function sortPayments(payments: readonly SortingPayment[], options: {
  categories: readonly { id: string }[]; learned?: Learned;
}): SortResult[] {
  const allowed = new Set(options.categories.map((c) => c.id));
  return payments.map((payment) => {
    const key = merchantKey(payment);
    const remembered = key && options.learned && Object.hasOwn(options.learned, key) ? options.learned[key] : null;
    if (remembered && allowed.has(remembered)) return { categoryId: remembered, source: "learned" };
    const categoryId = starterCategory(payment, options.categories);
    return { categoryId, source: categoryId ? "starter" : null };
  });
}
export function learn(learned: Learned, payment: SortingPayment, categoryId: string): Learned {
  const key = merchantKey(payment);
  return key ? { ...learned, [key]: categoryId } : { ...learned };
}
