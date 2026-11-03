import { buildDashboard, type DashboardSource } from "../data/dashboard.js";
import { fixedCostEntries, fixedCostList, monthlyAverage, type FixedCostMark } from "./fixed-costs.js";
import { merchantKey, cardMerchant, type SortingPayment } from "./sorting/merchant.js";
import { quickSortGroups } from "./quick-sort.js";
import { isCashWithdrawal } from "./receipts/count.js";
import type { SourceReceipt } from "./source.js";
import type { PaymentLink } from "../data/dashboard.js";
import { shopIdentities } from "./sorting/shop-identity.js";
export interface LedgerPaymentInfo extends SortingPayment {
  id: string;
  sequence?: number;
  ownName?: string | null;
  currency?: string;
  categorySource?: string | null;
}
export interface LedgerSettings {
  fixedCostMarks: FixedCostMark[];
  names: Record<string, string>;
  links: Record<string, PaymentLink[]>;
  paymentNames: Record<string, string>;
  ownNames: boolean;
  revision: number;
  cashEntries: SourceReceipt[];
  learned: Record<string, {
    spend?: string;
    income?: string;
  }>;
}
export const emptyLedgerSettings = (): LedgerSettings => ({
  fixedCostMarks: [],
  names: {},
  links: {},
  paymentNames: {},
  ownNames: true,
  revision: 0,
  cashEntries: [],
  learned: {}
});
/** Naming is applied after counting, and never enters bank ids, sorting or PayPal currency folding. */
export function buildLedgerDashboard(
  source: DashboardSource,
  payments: LedgerPaymentInfo[],
  settings = emptyLedgerSettings(),
  today = "") {
  const dashboard = buildDashboard(source);
  const keys = payments.map(merchantKey);
  const probes = payments.map((p) => merchantKey({
    counterparty: p.counterparty || p.description
  }));
  const universe = [...keys, ...probes, ...Object.keys(settings.names), ...Object.keys(settings.learned)];
  const resolved = shopIdentities(universe);
  const identities = resolved.slice(0, keys.length);
  const identityFor = new Map(universe.map((key, i) => [key, resolved[i]]));
  const rules = new Map<string, string>();
  for (const key of Object.keys(settings.names).sort()) {
    const identity = identityFor.get(key)!;
    if (!rules.has(identity))
      rules.set(identity, settings.names[key]);
  }
  const byId = new Map(payments.map((p, i) => [p.id, {
    p,
    key: keys[i],
    identity: identities[i]
  }]));
  const bankNames = new Map<string, string>();
  // Source order is oldest first; a card statement never replaces the readable bank name of its shop.
  for (const t of dashboard.transactions) {
    const info = byId.get(t.id);
    if (!info?.identity || t.receiptId || cardMerchant(t.place))
      continue;
    if (identityFor.get(merchantKey({
      counterparty: t.place
    })) === info.identity)
      bankNames.set(info.identity, t.place);
  }
  const transactions = dashboard.transactions.map(
    (t) => {
      const info = byId.get(t.id);
      if (!info)
        return {
          ...t,
          merchant: undefined,
          fixedCostKey: undefined,
          categorySource: undefined,
          isOwnName: false,
          nameKey: undefined,
          bankName: t.place,
          ownName: null,
          paymentOwnName: null,
          shopOwnName: null,
          ledgerSequence: undefined,
          paybackEligible: false
        };
      const paymentName = (Object.hasOwn(settings.paymentNames, t.id) ? settings.paymentNames[t.id] : undefined)
        ?? info.p.ownName;
      const shopName = Object.hasOwn(settings.names, info.key) ? settings.names[info.key] : rules.get(info.identity);
      const effective = paymentName === t.place ? undefined : paymentName ?? shopName;
      const own = settings.ownNames ? effective : undefined;
      const place = t.receiptId ? t.place : own || bankNames.get(info.identity) || t.place;
      return {
        ...t,
        categorySource: info.p.categorySource,
        paybackEligible: (info.p.currency ?? "EUR") === "EUR"
          && !isCashWithdrawal(
            {
              ...info.p,
              description: info.p.description ?? "",
              externalId: t.id,
              category: t.categoryName,
              date: t.date,
              amount: t.amount,
              currency: info.p.currency ?? "EUR"
            })
          && !t.receiptId
          && !t.coveredBy
          && (t.categoriesIn.length > 0 || t.incomeBuckets.length > 0)
          && t.amount !== 0,
        place,
        bankName: t.place,
        merchant: info.identity,
        nameKey: own
          ? "own:" + own.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().normalize("NFC")
          : info.identity ? "merchant:" + info.identity : "bank:" + t.place,
        isOwnName: !!own,
        ownName: effective ?? null,
        paymentOwnName: paymentName ?? null,
        shopOwnName: shopName ?? null,
        fixedCostKey: info.key ? "merchant:" + info.key : "bank:" + t.place,
        ledgerSequence: info.p.sequence
      };
    });
  const named = {
    ...dashboard,
    transactions
  };
  const entries = fixedCostEntries(named, settings.fixedCostMarks);
  const groups = new Map<string, typeof transactions>();
  for (const p of transactions) {
    if (!p.nameKey || p.coveredBy || !(p.categoriesIn.length || p.incomeBuckets.length))
      continue;
    const rows = groups.get(p.nameKey) ?? [];
    rows.push(p);
    groups.set(p.nameKey, rows);
  }
  const nameGroups = Object.fromEntries(
    [...groups].map(
      ([key, rows]) => {
        const ordered = rows.slice().sort(
          (a, b) => b.date.localeCompare(a.date) || (a.ledgerSequence ?? 0) - (b.ledgerSequence ?? 0));
        const amounts = (payments: typeof rows) => {
          const cents = (total: number, payment: typeof rows[number]) =>
            total + Math.round(Math.abs(payment.counted ?? payment.amount) * 100);
          return {
            moneyOut: payments.filter((payment) => payment.amount < 0).reduce(cents, 0) / 100,
            moneyIn: payments.filter((payment) => payment.amount > 0).reduce(cents, 0) / 100,
          };
        };
        const months = dashboard.months.map((month) => {
          const payments = rows.filter((payment) => payment.month === month.key);
          return [month.key, { ...amounts(payments), count: payments.length }];
        });
        const aliases = ordered.flatMap((payment) => [
          payment.place,
          payment.bankName,
          payment.ownName,
          payment.paymentOwnName,
          payment.shopOwnName,
        ].filter((name): name is string => !!name));
        return [
          key,
          {
            key,
            name: ordered[0].place,
            rows: ordered.map((p) => p.id),
            count: rows.length,
            ...amounts(rows),
            months: Object.fromEntries(months),
            names: [...new Set(aliases)],
            newestDate: ordered[0].date
          }
        ];
      }));
  const summed = new Map<string, Map<string, typeof transactions>>();
  for (const row of transactions) {
    if (!row.nameKey || row.coveredBy)
      continue;
    for (const [side, names] of [["spend", row.categoriesIn], ["income", row.incomeBuckets]] as const)
      for (const category of names) {
        const listKey = JSON.stringify([category, row.month, side]);
        const groups = summed.get(listKey) ?? new Map<string, typeof transactions>();
        const rows = groups.get(row.nameKey) ?? [];
        rows.push(row);
        groups.set(row.nameKey, rows);
        summed.set(listKey, groups);
      }
  }
  const summedLists = Object.fromEntries(
    [...summed].map(
      ([listKey, groups]) => {
        const [category, month, side] = JSON.parse(listKey) as [string, string, string];
        const rows = [...groups].map(
          ([key, rows]) => ({
            key,
            name: rows.at(-1)!.place,
            ids: rows.map((p) => p.id),
            count: rows.length,
            amount: rows.reduce((n, p) => n + Math.round((p.counted ?? p.amount) * 100), 0) / 100,
            latest: rows.at(-1)!.date,
            covered: false
          }));
        for (const row of transactions)
          if (row.coveredBy && row.month === month
            && (side === "spend" ? row.categoriesIn : row.incomeBuckets).includes(category)) {
            rows.push(
              {
                key: "covered:" + row.id,
                name: row.place,
                ids: [],
                count: 1,
                amount: row.counted ?? row.amount,
                latest: row.date,
                covered: true
              });
          }
        return [listKey, rows.sort((a, b) => b.latest.localeCompare(a.latest) || a.key.localeCompare(b.key))];
      }));
  const latest = dashboard.months.at(-1);
  const previous = dashboard.months.at(-2);
  const currentMonth = latest?.partial && Number(today.slice(8)) <= 7 && previous ? previous.key : latest?.key ?? null;
  return {
    ...named,
    today,
    currentMonth,
    nameGroups,
    summedLists,
    quickSort: quickSortGroups(transactions, Object.fromEntries(payments.map((p) => [p.id, p.description || ""]))),
    ownNames: settings.ownNames,
    monthlyAverage: {
      expenses: monthlyAverage(named, "expenses"),
      income: monthlyAverage(named, "income")
    },
    fixedCosts: {
      expenses: fixedCostList(entries, "expenses"),
      income: fixedCostList(entries, "income")
    }
  };
}
