import { buildSampleSource } from "./sample-source.js";
import { selectionSummary } from "../engine/selection.js";
import { paybackChoices, planPaybacks } from "../engine/payback-plan.js";
import { buildDashboardSource } from "../engine/source.js";
import { buildLedgerDashboard } from "../engine/ledger-dashboard.js";
// Invented examples only. Keep the original engine oracle generator unchanged.
export function buildWebSample() {
  const source = buildSampleSource();
  source.transactions = source.transactions.filter(
    (p) => !(p.place === "Spotify" && p.date > "2026-02-28")
      && !(p.place === "Northwind Werkstudent" && p.date.startsWith("2026-06")));
  for (const date of ["2025-12-03", "2026-06-03"])
    source.transactions.push(
      {
        id: "sample-insurance-" + date,
        date,
        amount: -120,
        place: "Fictional Insurance",
        city: "",
        categoryName: "Memberships",
        tags: [],
      });
  // The demo's restaurant visits are deliberately on scattered days, rather than an accidental subscription.
  source.transactions.filter((p) => p.place === "Maroush").forEach(
    (p) => {
      const month = Number(p.date.slice(5, 7));
      const day = Math.min(1 + (month * 11 % 25), source.months.find((m) => m.key === p.date.slice(0, 7))!.days);
      p.date = p.date.slice(0, 8) + String(day).padStart(2, "0");
    });
  if (!source.categories.some((c) => c.name === "Uncategorised"))
    source.categories.push(
      {
        name: "Uncategorised",
        kind: "spend",
        icon: "CircleHelp",
        color: "#9ca3af"
      });
  const examples = [
    ...["2026-04-12", "2026-05-17", "2026-06-09"].map(
      (date, i) => ({
        id: "sample-unsorted-out-" + i,
        date,
        amount: -15 - i * 3,
        categoryName: "Uncategorised",
        place: "Fictional Club"
      })),
    {
      id: "sample-unsorted-in",
      date: "2026-06-08",
      amount: 55,
      categoryName: "Uncategorised",
      place: "Fictional Club"
    },
    {
      id: "sample-unsorted-shop",
      date: "2026-06-10",
      amount: -24,
      categoryName: "Uncategorised",
      place: "Fictional Workshop"
    },
    {
      id: "sample-dinner",
      date: "2026-06-05",
      amount: -90,
      categoryName: "Restaurants",
      place: "Fictional Dinner"
    },
    {
      id: "sample-course",
      date: "2026-06-06",
      amount: -60,
      categoryName: "Education",
      place: "Fictional Course"
    },
    {
      id: "sample-friend",
      date: "2026-06-06",
      amount: 45,
      categoryName: "Basis",
      place: "Fictional Friend"
    },
    {
      id: "sample-payback-two",
      date: "2026-06-07",
      amount: 80,
      categoryName: "Basis",
      place: "Fictional Friend"
    },
    {
      id: "sample-payback-three",
      date: "2026-06-08",
      amount: 40,
      categoryName: "Basis",
      place: "Fictional Friend"
    },
  ];
  source.transactions.push(...examples.map((p) => ({
    ...p,
    city: "",
    tags: []
  })));
  source.transactions.sort((a, b) => a.date.localeCompare(b.date));
  const settings = {
    fixedCostMarks: [],
    names: {},
    paymentNames: {},
    ownNames: true,
    revision: 0,
    cashEntries: [
      {
        id: "sample-cash-gift",
        date: "2026-06-02",
        total: 50,
        currency: "EUR",
        method: "cash" as const,
        kind: "manual" as const,
        direction: "in" as const,
        shop: "Fictional Cash Gift",
        category: "Basis",
        paymentId: null
      },
      {
        id: "sample-cash-coffee",
        date: "2026-06-03",
        total: 12,
        currency: "EUR",
        method: "cash" as const,
        kind: "manual" as const,
        direction: "out" as const,
        shop: "Fictional Coffee",
        category: "Restaurants",
        paymentId: null,
        paidFrom: "sample-cash-gift"
      },
    ],
    learned: {},
    links: {
      "sample-friend": [{
        payment: "sample-dinner",
        amount: 45
      }]
    }
  };
  // Re-run the ordinary engine pipeline: the dinner's own share is €45; the friend's €45 is not income.
  const counted = buildDashboardSource(
    {
      receipts: settings.cashEntries,
      today: "2026-06-11",
      categories: source.categories.filter((c) => c.name !== "Uncategorised").map(
        (c) => ({
          ...c,
          side: c.kind === "transfer" ? undefined : c.kind,
          excludeFromTotals: c.kind === "transfer"
        })),
      transactions: source.transactions.map(
        (p) => ({
          id: p.id,
          externalId: p.id,
          date: p.date,
          amount: p.amount,
          currency: "EUR",
          category: p.categoryName === "Uncategorised" ? null : p.categoryName,
          tags: p.tags,
          counterparty: p.place,
          description: p.place,
          city: p.city,
          paysBack: settings.links[p.id as keyof typeof settings.links]
        }))
    });
  // Preserve the deterministic sample's original bank-balance curve.
  counted.balanceByDay = source.balanceByDay;
  counted.openingBalance = source.openingBalance;
  const dashboard = buildLedgerDashboard(
    counted,
    source.transactions.map(
      (p, i) => ({
        id: p.id,
        counterparty: p.place,
        amount: p.amount,
        sequence: i
      })).concat(
        settings.cashEntries.map(
          (p, i) => ({
            id: p.id,
            counterparty: p.shop,
            amount: p.direction === "in" ? p.total : -p.total,
            sequence: source.transactions.length + i
          }))),
    settings,
    "2026-06-11");
  const choices: Record<string, unknown> = {};
  const plans: Record<string, unknown> = {};
  const key = (ids: string[]) => ids.slice().sort().join("|");
  const groups = dashboard.transactions.filter((p) => p.paybackEligible && (p.counted ?? p.amount) !== 0)
    .map((p) => [p.id]);
  groups.push(["sample-dinner", "sample-course"], ["sample-payback-two", "sample-payback-three"]);
  for (const group of groups) {
    const choice = paybackChoices(dashboard, group);
    choices[key(group)] = {
      ...choice,
      group: choice.group.map((p) => p.id),
      candidates: choice.candidates.map((p) => p.id),
      plan: null,
      revision: "sample"
    };
    for (const other of choice.candidates) {
      plans[key([...group, other.id])] = {
        ...planPaybacks(dashboard, group, [other.id])
      };
    }
    const sampleOthers = choice.candidates.filter(
      (p) => ["sample-dinner", "sample-course", "sample-payback-two", "sample-payback-three"].includes(p.id))
    .map((p) => p.id);
    if (sampleOthers.length > 1)
      plans[key([...group, ...sampleOthers])] = planPaybacks(dashboard, group, sampleOthers);
  }
  const selectionPreviews = Object.fromEntries(
    groups.map(
      (ids) => [
        key(ids),
        {
          ...selectionSummary(dashboard.transactions, ids),
          revision: "sample"
        }
      ]));
  const categoryOptions = dashboard.categories.filter((c) => c.name !== "Uncategorised").map(
    (c) => ({
      ...c,
      id: "sample-category-" + c.name,
      side: c.kind === "transfer" ? null : c.kind,
      otherSide: c.otherSide || false,
      originalName: c.name,
      removed: false,
      default: true,
      protected: c.kind === "transfer",
      paymentCount: dashboard.transactions.filter((p) => p.categoryName === c.name || p.tags.includes(c.name)).length
    }));
  return {
    ...dashboard,
    cashEntries: settings.cashEntries,
    categoryOptions,
    selectionPreviews,
    demoPaybacks: {
      choices,
      plans
    }
  };
}
