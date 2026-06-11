// Typed aggregation layer for the dashboard. One function per screen of the
// drill-down (overview ↔ month ↔ category ↔ category×month). These run server-side
// against Postgres; the Next.js app will expose them via server functions / API routes.
//
// Conventions:
// - "expenses" are returned as POSITIVE magnitudes (money spent), excluding
//   excludeFromTotals categories (Transfer). "income" is positive money in.
// - "balance" is the VR Bank Kontostand (carried forward over gaps).
import { prisma } from "../lib/db.js";

const ym = (d: Date) => d.toISOString().slice(0, 7);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// "Bankgutschrift auf PayPal-Konto" = your bank funding a PayPal payment (money
// moving bank→PayPal), NOT income. The real expense is the separate PayPal payment
// row, so these funding legs are pure noise — excluded from all dashboard figures.
function isPaypalBankFunding(t: { description: string; raw: unknown }): boolean {
  const hay = (t.description + " " + JSON.stringify(t.raw ?? "")).toLowerCase();
  return hay.includes("bankgutschrift auf paypal");
}

export type CategoryTotal = {
  name: string;
  icon: string | null;
  color: string;
  excluded: boolean;
  net: number; // signed sum
  spend: number; // magnitude of negative amounts
  count: number;
};
export type MonthPoint = { month: string; expenses: number; income: number; balance: number | null };
export type DayPoint = { day: number; date: string; expenses: number; balance: number | null };

type TxnWithCat = Awaited<ReturnType<typeof fetchWithCategory>>[number];
function fetchWithCategory(where: object) {
  return prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { bookingDate: "asc" },
  });
}

function categoryTotals(txns: TxnWithCat[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of txns) {
    const c = t.category;
    const name = c?.name ?? "Uncategorised";
    const e =
      map.get(name) ??
      { name, icon: c?.icon ?? null, color: c?.color ?? "#9ca3af", excluded: c?.excludeFromTotals ?? false, net: 0, spend: 0, count: 0 };
    const amt = Number(t.amount);
    e.net += amt;
    if (amt < 0) e.spend += -amt;
    e.count += 1;
    map.set(name, e);
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}

// Screen 1 — overview: monthly expenses/income/balance + category totals for the whole range.
export async function getOverview() {
  const txns = await fetchWithCategory({});
  const months = new Map<string, { expenses: number; income: number; balance: number | null }>();
  for (const t of txns) {
    const m = ym(t.bookingDate);
    const e = months.get(m) ?? { expenses: 0, income: 0, balance: null };
    if (!(t.category?.excludeFromTotals ?? false)) {
      const amt = Number(t.amount);
      if (amt < 0) e.expenses += -amt;
      else e.income += amt;
    }
    if (t.balance != null) e.balance = Number(t.balance); // last (latest) bank txn of month wins
    months.set(m, e);
  }
  const monthly: MonthPoint[] = [...months.entries()].sort().map(([month, v]) => ({ month, ...v }));
  let last: number | null = null;
  for (const p of monthly) {
    if (p.balance != null) last = p.balance;
    else p.balance = last;
  }
  return { monthly, categories: categoryTotals(txns) };
}

// Screen 2 — a single month: per-day expenses/balance + category totals for that month.
export async function getMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const txns = await fetchWithCategory({ bookingDate: { gte: start, lt: end } });

  const prev = await prisma.transaction.findFirst({
    where: { source: "bank", balance: { not: null }, bookingDate: { lt: start } },
    orderBy: { bookingDate: "desc" },
    select: { balance: true },
  });

  const perDay = new Map<number, { expenses: number; balance: number | null }>();
  for (const t of txns) {
    const day = t.bookingDate.getUTCDate();
    const e = perDay.get(day) ?? { expenses: 0, balance: null };
    if (!(t.category?.excludeFromTotals ?? false) && Number(t.amount) < 0) e.expenses += -Number(t.amount);
    if (t.balance != null) e.balance = Number(t.balance);
    perDay.set(day, e);
  }

  let lastBal: number | null = prev?.balance != null ? Number(prev.balance) : null;
  const daily: DayPoint[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const e = perDay.get(d);
    if (e?.balance != null) lastBal = e.balance;
    daily.push({ day: d, date: `${month}-${String(d).padStart(2, "0")}`, expenses: e?.expenses ?? 0, balance: lastBal });
  }
  return { month, daily, categories: categoryTotals(txns) };
}

// Screen 3 — one category over time: monthly spend.
export async function getCategory(name: string) {
  const cat = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (!cat) return null;
  const txns = await prisma.transaction.findMany({
    where: { categoryId: cat.id },
    select: { amount: true, bookingDate: true },
    orderBy: { bookingDate: "asc" },
  });
  const months = new Map<string, number>();
  for (const t of txns) {
    const amt = Number(t.amount);
    if (amt < 0) months.set(ym(t.bookingDate), (months.get(ym(t.bookingDate)) ?? 0) + -amt);
  }
  const monthly = [...months.entries()].sort().map(([month, spend]) => ({ month, spend }));
  return { category: { name: cat.name, icon: cat.icon, color: cat.color }, monthly };
}

// Screen 4 — one category in one month: per-day spend + the individual places.
export async function getCategoryMonth(name: string, month: string) {
  const cat = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (!cat) return null;
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const txns = await prisma.transaction.findMany({
    where: { categoryId: cat.id, bookingDate: { gte: start, lt: end } },
    orderBy: { bookingDate: "asc" },
  });

  const perDay = new Map<number, number>();
  for (const t of txns) {
    const amt = Number(t.amount);
    if (amt < 0) perDay.set(t.bookingDate.getUTCDate(), (perDay.get(t.bookingDate.getUTCDate()) ?? 0) + -amt);
  }
  const daily = Array.from({ length: daysInMonth(y, m) }, (_, i) => ({ day: i + 1, spend: perDay.get(i + 1) ?? 0 }));
  const places = txns.map((t) => ({
    date: ymd(t.bookingDate),
    place: t.counterparty || t.description,
    city: t.city,
    amount: Number(t.amount),
  }));
  return { category: { name: cat.name, icon: cat.icon, color: cat.color }, month, daily, places };
}

// ---- Dashboard payload --------------------------------------------------------
// One flat snapshot the front-end aggregates client-side (see web/public/app/data.js).
// Mirrors the shape of the design's mock data so the UI code is unchanged: it reads
// only `window.AresiumData`. New imports/categories flow through automatically — the
// dashboard always reflects whatever is currently in Postgres.

// Lucide icon + accent colour per category, so the DB taxonomy renders with the
// design's crisp line-icons and electric palette. Names match the seed taxonomy;
// anything not listed (e.g. an LLM-invented category) falls back gracefully.
const CAT_META: Record<string, { icon: string; color: string }> = {
  Groceries: { icon: "ShoppingCart", color: "#26E07A" },
  Rent: { icon: "House", color: "#6366FF" },
  Travel: { icon: "TrainFront", color: "#13C8E8" },
  Vacation: { icon: "Palmtree", color: "#FF9F1C" },
  Education: { icon: "GraduationCap", color: "#FFB020" },
  Clothes: { icon: "Shirt", color: "#FF5CC8" },
  Drogerie: { icon: "SprayCan", color: "#10DBAE" },
  Restaurants: { icon: "Utensils", color: "#FF7A33" },
  Tech: { icon: "Laptop", color: "#8FA0C4" },
  Health: { icon: "Pill", color: "#FF4D6D" },
  Subscriptions: { icon: "Tv", color: "#A36BFF" },
  Fitness: { icon: "Dumbbell", color: "#34E27A" },
  "Non-essentials": { icon: "ShoppingBag", color: "#C77BFF" },
  "Personal care": { icon: "Scissors", color: "#FF7AD9" },
  Drinking: { icon: "Beer", color: "#FFC02E" },
  Memberships: { icon: "Handshake", color: "#3DA0FF" },
  Development: { icon: "Code", color: "#5B8CFF" },
  Trash: { icon: "Trash2", color: "#8A93A3" },
  Tax: { icon: "Receipt", color: "#E0894A" },
  Income: { icon: "Wallet", color: "#25E07A" },
  Basis: { icon: "Users", color: "#2BB0FF" },
  Transfer: { icon: "Repeat", color: "#9AA6B8" },
  Uncategorised: { icon: "CircleHelp", color: "#9ca3af" },
};
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function getDashboardData() {
  const txns = (await fetchWithCategory({})).filter((t) => !isPaypalBankFunding(t));
  const categoriesDb = await prisma.category.findMany();
  const today = new Date();

  // --- per-category net, to classify income vs spend (transfer = excludeFromTotals) ---
  const net = new Map<string, number>();
  let hasUncategorised = false;
  for (const t of txns) {
    const name = t.category?.name ?? "Uncategorised";
    if (!t.category) hasUncategorised = true;
    net.set(name, (net.get(name) ?? 0) + Number(t.amount));
  }

  const meta = (name: string, dbColor?: string) =>
    CAT_META[name] ?? { icon: "Tag", color: dbColor ?? "#9ca3af" };

  const categories = categoriesDb.map((c) => {
    const kind = c.excludeFromTotals ? "transfer" : (net.get(c.name) ?? 0) > 0 ? "income" : "spend";
    const m = meta(c.name, c.color);
    return { name: c.name, icon: m.icon, color: m.color, kind };
  });
  if (hasUncategorised) {
    categories.push({ name: "Uncategorised", ...meta("Uncategorised"), kind: "spend" });
  }

  // --- transactions in the flat shape the UI expects ---
  const transactions = txns.map((t) => ({
    id: t.id,
    date: ymd(t.bookingDate),
    amount: Number(t.amount),
    categoryName: t.category?.name ?? "Uncategorised",
    place: t.counterparty || t.description,
    city: t.city ?? "",
  }));

  // --- month list spanning the data range ---
  const months: {
    key: string; label: string; short: string; year: number; month: number; days: number; partial: boolean;
  }[] = [];
  if (txns.length) {
    const first = txns[0].bookingDate; // ordered asc by fetchWithCategory
    const last = txns[txns.length - 1].bookingDate;
    let y = first.getUTCFullYear(), m = first.getUTCMonth();
    while (y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth())) {
      const isCurrent = y === today.getUTCFullYear() && m === today.getUTCMonth();
      months.push({
        key: `${y}-${String(m + 1).padStart(2, "0")}`,
        label: `${MONTH_ABBR[m]} ${y}`,
        short: MONTH_ABBR[m],
        year: y, month: m,
        days: isCurrent ? today.getUTCDate() : daysInMonth(y, m + 1),
        partial: isCurrent,
      });
      m++; if (m > 11) { m = 0; y++; }
    }
  }

  // --- balance for every day in range (forward-filled from bank's Saldo) ---
  const balanceByDay: Record<string, number> = {};
  let openingBalance = 0;
  if (months.length) {
    const balAt = new Map<string, number>(); // ymd -> last known balance that day
    for (const t of txns) if (t.balance != null) balAt.set(ymd(t.bookingDate), Number(t.balance));
    const firstKnown = txns.find((t) => t.balance != null);
    openingBalance = firstKnown ? Number(firstKnown.balance) : 0;
    let bal = openingBalance;
    for (const mo of months) {
      for (let d = 1; d <= mo.days; d++) {
        const ds = `${mo.key}-${String(d).padStart(2, "0")}`;
        if (balAt.has(ds)) bal = balAt.get(ds)!;
        balanceByDay[ds] = bal;
      }
    }
  }

  return { categories, months, transactions, balanceByDay, openingBalance };
}

// ---- Single-transaction detail -----------------------------------------------
// Full record behind one purchase: every stored field plus the untouched original
// export row (`raw`) — i.e. exactly what the bank/PayPal statement showed. Backs the
// click-through detail modal (GET /api/transaction/:id).
export async function getTransactionDetail(id: string) {
  const t = await prisma.transaction.findUnique({
    where: { id },
    include: { category: true, account: true },
  });
  if (!t) return null;
  const catName = t.category?.name ?? "Uncategorised";
  const accent = CAT_META[catName]?.color ?? t.category?.color ?? "#9ca3af";
  return {
    id: t.id,
    place: t.counterparty || t.description,
    amount: Number(t.amount),
    currency: t.currency,
    bookingDate: ymd(t.bookingDate),
    valueDate: t.valueDate ? ymd(t.valueDate) : null,
    balance: t.balance != null ? Number(t.balance) : null,
    category: catName,
    categoryColor: accent,
    categorySource: t.categorySource, // rule | llm | manual
    categorized: t.categorized,
    description: t.description,
    counterparty: t.counterparty,
    account: t.account?.name ?? null,
    iban: t.account?.iban ?? null,
    source: t.source, // bank | paypal
    city: t.city,
    country: t.country,
    trip: t.trip,
    tripKind: t.tripKind, // vacation | travel
    placeType: t.placeType,
    recurring: t.recurring,
    externalId: t.externalId,
    raw: t.raw, // original export row, verbatim
  };
}

// Manually move a transaction to another category. Marks it categorySource="manual"
// (so rules/LLM never overwrite it) and appends a CategoryCorrection row — the
// training signal the LLM reads on its next run. No-op (and unlogged) if unchanged.
export async function recategorizeTransaction(id: string, categoryName: string) {
  const t = await prisma.transaction.findUnique({ where: { id }, include: { category: true } });
  if (!t) return { error: "not found" as const };
  const target = await prisma.category.findFirst({
    where: { name: { equals: categoryName, mode: "insensitive" } },
  });
  if (!target) return { error: "unknown category" as const };

  if (target.id !== t.categoryId) {
    await prisma.$transaction([
      prisma.transaction.update({
        where: { id },
        data: { categoryId: target.id, categorized: true, categorySource: "manual" },
      }),
      prisma.categoryCorrection.create({
        data: {
          transactionId: id,
          merchant: t.counterparty || t.description,
          fromCategory: t.category?.name ?? null,
          toCategory: target.name,
          fromSource: t.categorySource ?? null,
        },
      }),
    ]);
  }
  return { detail: await getTransactionDetail(id) };
}
