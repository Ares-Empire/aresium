import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboard, type Dashboard, type Category } from "../data/dashboard.js";
import {
  fixedCostEntries as entries, fixedCostList as list, monthlyAverage, nextFixedDay,
  type NamedTxn
} from "./fixed-costs.js";
const monthly = ["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"];
const row = (
  id: string,
  date: string,
  amount = -800,
  name = "Fictional Rent",
  key: string | undefined = "merchant:fictional rent",
  counted?: number): NamedTxn => ({
    id,
    date,
    day: Number(date.slice(8)),
    month: date.slice(0, 7),
    amount,
    categoryName: amount < 0 ? "Housing" : "Salary",
    tags: [],
    place: name,
    city: "",
    categoriesIn: amount < 0 ? ["Housing"] : [],
    incomeBuckets: amount > 0 ? ["Salary"] : [],
    nameKey: key,
    ...(counted === undefined ? {} : {
      counted
    }),
  });
const rows = (
  days = monthly,
  amount = -800,
  prefix = "rent",
  name = "Fictional Rent",
  key = "merchant:fictional rent") => days.map((day, i) => row(prefix + i, day, amount, name, key));
const dashboard = (transactions: NamedTxn[]) => ({
  ...buildDashboard(
    {
      months: [],
      categories: [
        {
          name: "Housing",
          kind: "spend",
          icon: "house",
          color: "#123456"
        },
        {
          name: "Salary",
          kind: "income",
          icon: "banknote",
          color: "#123456"
        },
        {
          name: "Transfer",
          kind: "transfer",
          icon: "arrow",
          color: "#123456"
        },
      ],
      transactions: [],
      balanceByDay: {},
      openingBalance: 0,
      databaseCategoryNames: []
    }),
  transactions
});
const find = (payments: NamedTxn[]) => entries(dashboard(payments));
// The cases and expected cents below are ported from AresiumTests/FixedCostsTests.swift, through brief 217.
test(
  "Swift rent raise and stepped raises retain one series and newest price",
  () => {
    const p = rows();
    p[3].amount = -850;
    const e = find(p)[0];
    assert.equal(find(p).length, 1);
    assert.equal(e.cents, 85000);
    assert.equal(e.count, 4);
    assert.equal(e.nextDue, "2026-11-03");
    assert.deepEqual(e.ids, ["rent3", "rent2", "rent1", "rent0"]);
    assert.equal(find([...p, row("next", "2026-11-03", -900)])[0].id, e.id);
  });
test(
  "Swift two simultaneous subscriptions keep independent anchors and exclusions",
  () => {
    const d = dashboard([...rows(monthly, -10), ...rows(monthly, -30, "video")]);
    const e = entries(d);
    assert.equal(e.length, 2);
    assert.notEqual(e[0].id, e[1].id);
    const excluded = list(entries(d, [e[0].mark]), "expenses");
    assert.equal(excluded.running.length, 1);
    assert.equal(excluded.takenOut.length, 1);
  });
for (const newPrice of [56.5, 65])
  test(
    `Swift transit price step ${newPrice} both directions retains twelve rows`,
    () => {
      for (const sign of [-1, 1]) {
        const p = Array.from(
          {
            length: 12
          },
          (_, i) => row(
            "transit" + (i + 1),
            `2026-${String(i + 1).padStart(2, "0")}-01`,
            sign * (i < 2 ? 50 : newPrice)));
        const e = find(p);
        assert.equal(e.length, 1);
        assert.equal(e[0].count, 12);
        assert.equal(e[0].cents, newPrice * 100);
        assert.equal(e[0].nextDue, "2027-01-01");
      }
    });
test(
  "Swift overlapping subscriptions own their rows after the cheaper one stops",
  () => {
    const e = find(
      [
        ...rows(["2026-01-01", "2026-02-01", "2026-03-01"], -10),
        ...rows(
          ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"],
          -30,
          "dear")
      ]);
    assert.equal(e.length, 2);
    assert.equal(e.find((e) => e.cents === 1000)?.running, false);
    assert.equal(list(e, "expenses").monthlyCents, 3000);
  });
test(
  "Swift price steps require the next period and same steady day",
  () => {
    for (const days of [["2026-05-01", "2026-06-01", "2026-07-01"], ["2026-04-09", "2026-05-09", "2026-06-09"]]) {
      const e = find([...rows(["2026-01-01", "2026-02-01", "2026-03-01"], -50), ...rows(days, -65, "new")]);
      assert.equal(e.length, 2);
      assert.ok(e.every((e) => e.count === 3));
    }
  });
test(
  "Swift quarterly series cannot carry an ended monthly subscription",
  () => {
    const e = find(
      [
        ...rows(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"], -10),
        ...rows(["2026-07-01", "2026-10-01", "2027-01-01"], -30, "q")
      ]);
    assert.equal(e.length, 2);
    assert.equal(list(e, "expenses").monthlyCents, 1000);
    assert.equal(e.find((e) => e.cadence === "monthly")?.running, false);
  });
test(
  "Swift price step and combined fee count their own portions",
  () => {
    const p = Array.from(
      {
        length: 12
      },
      (_, i) => row(
        "step" + (i + 1),
        `2026-${String(i + 1).padStart(2, "0")}-01`,
        -((i < 2 ? 50 : 65) + ([5, 11].includes(i) ? 60 : 0))));
    const e = find(p);
    assert.equal(e.length, 2);
    assert.equal(e.find((e) => e.cadence === "monthly")?.count, 12);
    assert.equal(e.find((e) => e.cadence === "halfYearly")?.cents, 6000);
    assert.equal(list(e, "expenses").monthlyCents, 7500);
  });
for (const [oldDays, newDays, cadence] of [
  [["2026-01-31", "2026-02-28"], ["2026-04-01", "2026-04-30"], "monthly"],
  [["2025-01-03", "2025-04-03"], ["2025-07-06", "2025-10-03"], "quarterly"],
  [["2024-01-03", "2024-07-03"], ["2025-01-03", "2025-07-03"], "halfYearly"],
  [["2023-01-03", "2024-01-03"], ["2025-01-03", "2026-01-03"], "yearly"],
] as const)
  test(
    `Swift ${cadence} price steps including month-end`,
    () => {
      const e = find([...rows([...oldDays], -50), ...rows([...newDays], -65, "new")]);
      assert.equal(e.length, 1);
      assert.equal(e[0].count, 4);
      assert.equal(e[0].cadence, cadence);
      assert.equal(e[0].cents, 6500);
    });
test(
  "Swift merged price steps retain marks from either segment in stored order",
  () => {
    const a = rows(["2026-01-01", "2026-02-01", "2026-03-01"], -50);
    const b = rows(["2026-04-01", "2026-05-01", "2026-06-01"], -65, "new");
    const ma = find(a)[0].mark;
    const mb = find(b)[0].mark;
    for (const marks of [[ma], [mb], [ma, mb], [mb, ma]]) {
      const e = entries(dashboard([...a, ...b]), marks)[0];
      assert.equal(e.id, [marks[0].key, marks[0].side, marks[0].cadence, marks[0].anchor].join("\u001f"));
      assert.equal(e.exclusionIDs.length, marks.length);
      assert.equal(list([e], "expenses").monthlyCents, 0);
    }
  });
test(
  "Swift weekly shop and duplicate monthly payment are not regular",
  () => {
    assert.equal(
      find(rows(["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29"], -22)).length,
      0);
    assert.equal(find([...rows(), row("extra", "2026-08-10")]).length, 0);
  });
test(
  "Swift yearly supermarket and half-yearly restaurant need a clean span",
  () => {
    const pair = rows(["2025-10-15", "2026-10-15"], -25);
    const visits = Array.from(
      {
        length: 40
      },
      (_, i) => row(
        "visit" + i,
        new Date(Date.parse("2025-11-01T12:00Z") + i * 7 * 86400000).toISOString().slice(0, 10),
        -(60 + i % 4)));
    assert.equal(find([...pair, ...visits]).length, 0);
    assert.equal(
      find(
        [
          ...rows(["2026-04-15", "2026-10-15"], -30),
          ...rows(["2026-05-02", "2026-05-19", "2026-08-10"], -80, "visit")
        ]).length,
      0);
  });
test(
  "Swift monthly gym plus separate fee; irregular visits block only long cadence",
  () => {
    const p = [
      ...rows(monthly, -40),
      ...rows(["2026-04-03", "2026-10-03"], -120, "half"),
      row("refund", "2026-10-05", 200)
    ];
    assert.deepEqual(find(p).map((e) => e.cadence).sort(), ["halfYearly", "monthly"]);
    assert.deepEqual(find([...p, row("visit", "2026-08-19", -200)]).map((e) => e.cadence), ["monthly"]);
  });
const combinedGym = () => [
  row("signup", "2026-01-01", -160),
  ...[
    "2026-02-01",
    "2026-03-01",
    "2026-05-01",
    "2026-06-01",
    "2026-07-01",
    "2026-09-01",
    "2026-10-01",
    "2026-11-01",
    "2026-12-01"
  ].map((day, i) => row("gym" + i, day, ["2026-06-01", "2026-12-01"].includes(day) ? -100 : -40))
];
test(
  "Swift combined gym with pauses, signup, latest combined booking and fee has no double count",
  () => {
    for (const [extra, count] of [[row("month", "2027-01-01", -40), 11], [row("ref", "2027-01-10", 1), 10]] as const) {
      const e = find([...combinedGym(), extra]);
      assert.equal(e.length, 2);
      const base = e.find((e) => e.cadence === "monthly")!;
      const fee = e.find((e) => e.cadence === "halfYearly")!;
      assert.equal(base.count, count);
      assert.equal(base.cents, 4000);
      assert.equal(base.running, true);
      assert.equal(fee.cents, 6000);
      assert.deepEqual(fee.ids, ["gym8", "gym3"]);
      assert.equal(list(e, "expenses").monthlyCents, 5000);
    }
  });
test(
  "Swift quarterly combined bookings obey phase and allocate only extras",
  () => {
    const e = find(
      [
        ...rows(["2025-01-03", "2025-04-03", "2025-10-03", "2026-04-03"], -90),
        ...rows(["2025-07-03", "2026-01-03", "2026-07-03"], -150, "combined"),
        row("off", "2026-08-03", -210)
      ]);
    assert.equal(e.length, 2);
    assert.equal(e.find((e) => e.cadence === "quarterly")?.count, 7);
    assert.equal(e.find((e) => e.cadence === "halfYearly")?.cents, 6000);
    assert.equal(list(e, "expenses").monthlyCents, 4000);
  });
test(
  "Swift combined bookings use counted cents and current price in both directions",
  () => {
    for (const sign of [-1, 1]) {
      const p = rows(["2026-01-01", "2026-02-01", "2026-03-01"], sign * 40);
      p[2].amount = sign * 44;
      p.push(
        row(
          "combined",
          "2026-04-01",
          sign * 208,
          "Fictional Rent",
          "merchant:fictional rent",
          sign * 104));
      const e = find(p)[0];
      assert.equal(e.count, 4);
      assert.equal(e.cents, 4400);
    }
  });
test(
  "Swift combined month-end wraps; a second ordinary payment refuses the series",
  () => {
    const p = [...rows(["2026-05-01", "2026-06-01", "2026-07-01"], -40), row("combined", "2026-07-31", -100)];
    assert.equal(find(p)[0].count, 4);
    assert.equal(find([...p, row("duplicate", "2026-06-02", -40)]).length, 0);
  });
test(
  "Swift marks survive combined rows and fee changes; lost anchor stays unmatched",
  () => {
    const p = combinedGym();
    const base = find(p.filter((p) => p.date < "2026-12-01"))[0];
    const fee = find(p.filter((p) => ["gym3", "gym8"].includes(p.id)))[0];
    const e = entries(dashboard(p), [base.mark, fee.mark]);
    assert.equal(e.filter((e) => e.notFixed).length, 2);
    assert.equal(e.find((e) => e.cadence === "halfYearly")?.id, fee.id);
    assert.ok(
      entries(dashboard(p), [{
        ...fee.mark,
        anchor: "signup"
      }]).every((e) => !e.notFixed));
  });
test(
  "Swift scattered monthly and quarterly shopping days are not fixed",
  () => {
    for (const days of [
      [
        "2026-01-01",
        "2026-02-04",
        "2026-03-08",
        "2026-04-12",
        "2026-05-16",
        "2026-06-20",
        "2026-07-24",
        "2026-08-28",
        "2026-10-01",
        "2026-11-05",
        "2026-12-09"
      ],
      [
        "2025-01-01",
        "2025-04-04",
        "2025-07-08",
        "2025-10-12",
        "2026-01-16",
        "2026-04-20",
        "2026-07-24",
        "2026-10-28"
      ]
    ])
      assert.equal(find(rows(days, -25)).length, 0);
  });
test(
  "Swift steady day allows working-day shifts and month-end February clamping",
  () => {
    for (const days of [
      ["2026-01-01", "2026-02-02", "2026-03-04", "2026-04-02", "2026-05-01", "2026-06-03"],
      ["2026-05-30", "2026-06-30", "2026-07-31", "2026-09-01", "2026-10-02"],
      ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-06-01"],
      ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]
    ])
      assert.equal(find(rows(days)).length, 1);
    assert.equal(nextFixedDay("2026-01-31", "monthly"), "2026-02-28");
    assert.equal(nextFixedDay("2024-02-29", "yearly"), "2025-02-28");
    assert.equal(nextFixedDay("2026-11-30", "quarterly"), "2027-02-28");
  });
test(
  "Swift exactly three quarters and five-day tolerance",
  () => {
    assert.equal(
      find(
        rows(
          [
            "2026-01-03",
            "2026-02-03",
            "2026-03-03",
            "2026-04-03",
            "2026-05-03",
            "2026-06-08",
            "2026-07-13",
            "2026-08-13"
          ])).length,
      1);
    assert.equal(
      find(
        rows(
          [
            "2026-01-03",
            "2026-02-03",
            "2026-03-03",
            "2026-04-03",
            "2026-05-03",
            "2026-06-09",
            "2026-07-13",
            "2026-08-13"
          ])).length,
      0);
  });
test(
  "Swift running grace is inclusive and uses newest ledger payment, not clock",
  () => {
    assert.equal(find([...rows(), row("ref", "2026-11-17", 1)])[0].running, true);
    assert.equal(find([...rows(), row("ref", "2026-11-18", 1)])[0].running, false);
  });
for (const [days, cadence, amount, equivalent] of [
  [["2025-10-31", "2026-10-31"], "yearly", -120.01, 10],
  [["2026-04-30", "2026-10-31"], "halfYearly", -60.04, 10.01],
  [["2026-04-03", "2026-07-03", "2026-10-03"], "quarterly", -90.01, 30],
  [["2026-07-03", "2026-08-03", "2026-10-03"], "monthly", -42, 42],
] as const)
  test(
    `Swift ${cadence} precision and missing period`,
    () => {
      const e = find(rows([...days], amount));
      assert.equal(e.length, 1);
      assert.equal(e[0].cadence, cadence);
      assert.equal(e[0].monthlyEquivalent, equivalent);
    });
test(
  "Swift minimum counts and three quarters of intervals",
  () => {
    assert.equal(find(rows(monthly.slice(0, 2))).length, 0);
    assert.equal(find(rows(["2026-04-03", "2026-07-03"])).length, 0);
    assert.equal(
      find(rows(["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03", "2026-10-16"])).length,
      1);
    assert.equal(
      find(rows(["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-16", "2026-10-29"])).length,
      0);
  });
test(
  "Swift counted half, regular income, totals and order",
  () => {
    const e = find(
      [
        ...rows().map((p) => ({
          ...p,
          counted: -400
        })),
        ...rows(monthly, 2400, "salary", "Fictional Works", "merchant:works"),
        ...rows(monthly, 150, "parent", "Fictional Parent", "own:parent"),
        ...rows(monthly, -10, "b", "B Fictional Club", "bank:B"),
        ...rows(monthly, -10, "a", "A Fictional Club", "merchant:a")
      ]);
    assert.equal(list(e, "expenses").monthlyTotal, 420);
    assert.equal(list(e, "income").monthlyTotal, 2550);
    assert.deepEqual(
      list(e, "expenses").running.map((e) => e.name),
      ["Fictional Rent", "A Fictional Club", "B Fictional Club"]);
  });
test(
  "Swift receipts, cash, withdrawals, covered, transfers and counted zero never qualify",
  () => {
    for (const patch of [
      {
        receiptId: "receipt"
      },
      {
        cashWithdrawal: true
      },
      {
        coveredBy: ["cash"]
      },
      {
        categoryName: "Transfer"
      },
      {
        counted: 0
      },
      {
        nameKey: undefined
      },
      {
        categoriesIn: [],
        incomeBuckets: []
      }
    ])
      assert.equal(find(rows().map((p) => ({
        ...p,
        ...patch
      }))).length, 0);
  });
test(
  "Swift anchor survives older import, and ended order newest first",
  () => {
    const base = rows().map((p, i) => ({
      ...p,
      ledgerSequence: i
    }));
    const old = {
      ...row("older", "2026-06-03"),
      ledgerSequence: 4
    };
    const e = find(base)[0];
    assert.equal(find([...base, old])[0].id, e.id);
    assert.equal(entries(dashboard([...base, old]), [e.mark])[0].notFixed, true);
  });
test(
  "Swift average excludes partial and late first month on both sides and rounds cents",
  () => {
    const d: Dashboard = dashboard([row("first", "2026-06-08")]);
    d.months = [6, 7, 8, 9, 10].map(
      (m) => ({
        key: `2026-${String(m).padStart(2, "0")}`,
        label: "",
        short: "",
        year: 2026,
        month: m - 1,
        days: 30,
        partial: m === 10
      }));
    for (const m of d.months)
      d.byMonth[m.key] = {
        expense: (m.month + 1) === 10 ? 9999 : (m.month + 1) * 10.01,
        income: (m.month + 1) * 100,
        categories: [],
        incomeBuckets: [],
        endBalance: 0,
        dayExpense: [],
        dayExpenseRunning: [],
        dayIncome: [],
        dayBalance: []
      };
    assert.deepEqual(
      monthlyAverage(d, "expenses"),
      {
        count: 3,
        first: "2026-07",
        last: "2026-09",
        cents: 8008,
        amount: 80.08
      });
    assert.equal(monthlyAverage(d, "income")?.amount, 800);
    d.transactions[0].date = "2026-06-07";
    assert.equal(monthlyAverage(d, "expenses")?.cents, 7508);
    d.months = d.months.slice(-2);
    assert.equal(monthlyAverage(d, "expenses"), null);
    assert.equal(monthlyAverage(dashboard([]), "income"), null);
  });

test(
  "Swift insurance's two yearly payments suffice and one-offs outside its span do not block it",
  () => {
    const insurance = rows(["2025-10-15", "2026-10-15"], -498.96);
    assert.equal(find(insurance)[0].cents, 49896);
    const outside = [row("before", "2025-01-03", -180), row("after", "2026-10-30", -230)];
    assert.equal(find([...insurance, ...outside]).length, 1);
    assert.equal(find([...insurance, ...outside, row("inside", "2026-01-03", -700)]).length, 0);
  });
test(
  "Swift combined booking fills an empty usual-day period only, respecting direction",
  () => {
    const membership = rows(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"], -40);
    const others = [
      row("occupied", "2026-03-02", -100),
      row("wrong-day", "2026-04-15", -100),
      row("income", "2026-04-01", 100)
    ];
    assert.equal(find([...membership, ...others])[0].count, 5);
    assert.equal(find([...membership, ...others, row("combined", "2026-04-06", -100)])[0].count, 6);
  });
test(
  "Swift consecutive higher monthly bookings are a price step, never a separate monthly extra",
  () => {
    const ordinary = rows(["2026-01-01", "2026-02-01", "2026-03-01"], -40);
    const higher = rows(["2026-04-01", "2026-05-01", "2026-06-01"], -100, "higher");
    const mark = find(higher)[0].mark;
    const e = entries(dashboard([...ordinary, ...higher]), [mark]);
    assert.equal(e.length, 1);
    assert.equal(e[0].count, 6);
    assert.equal(e[0].cents, 10000);
    assert.equal(e[0].notFixed, true);
  });
test(
  "Swift ended entries are ordered by last payment",
  () => {
    const older = rows(["2026-01-03", "2026-02-03", "2026-03-03"], -800, "old", "Fictional Old", "merchant:old");
    const later = rows(
      ["2026-02-03", "2026-03-03", "2026-04-03"],
      -800,
      "later",
      "Fictional Later",
      "merchant:later");
    assert.deepEqual(
      list(
        find(
          [
            ...older,
            ...later,
            {
              ...row("ref", "2026-10-03", 1),
              nameKey: undefined
            }
          ]),
        "expenses").ended.map((e) => e.last),
      ["2026-04-03", "2026-03-03"]);
  });

test(
  "Swift combined bookings repair cadence gaps before deciding regularity",
  () => {
    const ordinary = rows(
      [
        "2026-01-01",
        "2026-02-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-10-01",
        "2026-11-01",
        "2026-12-01"
      ],
      -40);
    assert.equal(find(ordinary).length, 0);
    const e = find(
      [
        ...ordinary,
        ...rows(["2026-03-01", "2026-09-01"], -100, "combined"),
        row("signup", "2025-12-01", -160)
      ]);
    assert.equal(e.length, 2);
    assert.equal(e.find((e) => e.cadence === "monthly")?.count, 11);
    assert.equal(list(e, "expenses").monthlyCents, 5000);
  });
test(
  "Swift extras mix separate/combined fees and tolerate amount changes",
  () => {
    const ordinary = rows(
      [
        "2025-01-01",
        "2025-02-01",
        "2025-04-01",
        "2025-05-01",
        "2025-06-01",
        "2025-07-01",
        "2025-08-01",
        "2025-09-01",
        "2025-10-01",
        "2025-11-01",
        "2025-12-01",
        "2026-01-01",
        "2026-02-01"
      ],
      -40);
    const e = find(
      [
        ...ordinary,
        row("first-combined", "2025-03-01", -100),
        row("separate", "2025-09-01", -60),
        row("latest-combined", "2026-03-01", -104)
      ]);
    const fee = e.find((e) => e.cadence === "halfYearly")!;
    assert.equal(e.length, 2);
    assert.equal(fee.cents, 6400);
    assert.equal(fee.monthlyCents, 1067);
    assert.equal(fee.count, 3);
    assert.deepEqual(fee.ids, ["latest-combined", "separate", "first-combined"]);
    assert.equal(list(e, "expenses").monthlyCents, 5067);
  });
