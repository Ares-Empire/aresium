/* Aresium — version 2 lookup adapter. The server supplies every dashboard number.
   The generated sample supplies the same payload when opened from file://. */
(function () {
  "use strict";

  function adaptDashboard(data) {
    if (!data || data.version !== 2) throw new Error("Expected dashboard version 2");
    const { categories, months } = data;
    const catByName = Object.fromEntries(categories.map((c) => [c.name, c]));
    const incomeMeta = Object.fromEntries(data.incomeBuckets.map((c) => [c.name, c]));
    const INCOME_META = {
      Refunds: { name: "Refunds", icon: "RotateCcw", color: "#34E27A", kind: "income" },
      Other: { name: "Other", icon: "CircleHelp", color: "#9AA6B8", kind: "income" },
    };
    const incomeBucketMeta = (name) => catByName[name] || incomeMeta[name] || INCOME_META[name]
      || { name, icon: "Tag", color: "#34E27A", kind: "income" };
    // Retain the old transaction shapes; v2's listing indexes stay in the payload.
    const transactions = data.transactions.map(({ id, date, amount, categoryName, tags, place, city }) =>
      ({ id, date, amount, categoryName, tags, place, city }));
    const zeroDays = (key) => new Array(months.find((m) => m.key === key).days).fill(0);
    const monthSeries = (table, name) => table[name] ? table[name].months : months.map(() => 0);
    const daySeries = (table, name, key) => table[name] ? table[name].days[key] : zeroDays(key);
    const monthList = (table, name) => {
      const series = monthSeries(table, name);
      return months.map((m, i) => ({ ...m, total: series[i] })).filter((m) => m.total > 0);
    };
    const categoryRows = (totals) => totals.map(({ name, total }) => ({ ...catByName[name], total }));
    const incomeRows = (totals) => totals.map(({ name, total }) => ({ ...incomeBucketMeta(name), total }));
    const monthTransactions = (name, key, income) => data.transactions
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.month === key && (income ? t.incomeBuckets : t.categoriesIn).indexOf(name) !== -1)
      .map(({ t, i }) => ({ ...transactions[i], day: t.day,
        tagged: (income ? t.incomeBuckets[0] : t.categoryName) !== name }))
      .sort((a, b) => a.day - b.day);
    // This legacy helper also accepts negative transactions and arbitrary objects.
    const primaryBucketByCategory = Object.fromEntries(categories.map((c) => [c.name,
      c.kind === "income" || c.kind === "transfer" || c.name === "Tax" ? c.name : "Refunds"]));
    const incomeBucketOf = (t) => !t.categoryName || t.categoryName === "Uncategorised" ? "Other"
      : primaryBucketByCategory[t.categoryName] || (t.categoryName === "Tax" ? "Tax" : "Refunds");
    return {
      categories, catByName, months, transactions, pick: data.pick,
      monthExpense: (key) => data.byMonth[key] ? data.byMonth[key].expense : 0,
      monthEndBalance: (key) => data.byMonth[key] ? data.byMonth[key].endBalance : 0,
      dayExpenseSeries: (key) => data.byMonth[key].dayExpense,
      dayBalanceSeries: (key) => data.byMonth[key].dayBalance,
      categoryMonthSeries: (cat) => monthSeries(data.spend, cat),
      categoryDaySeries: (cat, key) => daySeries(data.spend, cat, key),
      categoryTotalsAll: () => categoryRows(data.total.categories),
      categoryTotalsMonth: (key) => categoryRows(data.byMonth[key] ? data.byMonth[key].categories : []),
      expenseTotal: (key) => !key ? data.total.expense : data.byMonth[key] ? data.byMonth[key].expense : 0,
      incomeTotalPrimary: (key) => !key ? data.total.income : data.byMonth[key] ? data.byMonth[key].income : 0,
      categoryMonthList: (cat) => monthList(data.spend, cat),
      categoryMonthTransactions: (cat, key) => monthTransactions(cat, key, false),
      incomeBucketOf, incomeBucketMeta,
      incomeDaySeries: (key) => data.byMonth[key].dayIncome,
      incomeTotalsAll: () => incomeRows(data.total.incomeBuckets),
      incomeTotalsMonth: (key) => incomeRows(!key ? data.total.incomeBuckets : data.byMonth[key] ? data.byMonth[key].incomeBuckets : []),
      incomeBucketMonthSeries: (bucket) => monthSeries(data.income, bucket),
      incomeBucketDaySeries: (bucket, key) => daySeries(data.income, bucket, key),
      incomeBucketMonthList: (bucket) => monthList(data.income, bucket),
      incomeBucketMonthTransactions: (bucket, key) => monthTransactions(bucket, key, true),
      overviewMonthExpense: data.overview.expense,
      overviewMonthBalance: data.overview.balance,
      overviewMonthIncome: data.overview.income,
    };
  }

  // Synchronous initial load keeps the object available to the existing React modules.
  // Opened as a local file → the generated sample. On the live site a failed load shows an
  // error instead: made-up numbers must never look like real ones.
  function loadDashboard() {
    if (location.protocol === "file:") return window.AresiumSample;
    let status = "no response";
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/api/data", false);
      xhr.setRequestHeader("Accept-Language", "en");
      xhr.send(null);
      status = xhr.status;
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        if (data && data.version === 2) return data;
        status = "unexpected format";
      }
    } catch (e) { /* network error: reported below */ }
    document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">Could not load your data (' +
      status + '). Reload the page to try again.</p>';
    throw new Error("Aresium: /api/data failed (" + status + ")");
  }

  // Preserve the object captured by the desktop and mobile modules across refreshes.
  function applyDashboard(data) {
    const built = adaptDashboard(data);
    if (!window.AresiumData) window.AresiumData = {};
    Object.keys(window.AresiumData).forEach((k) => {
      if (k !== "refresh" && !(k in built)) delete window.AresiumData[k];
    });
    Object.assign(window.AresiumData, built);
  }
  async function refresh() {
    const res = await fetch("/api/data", { cache: "no-store", headers: { "Accept-Language": "en" } });
    if (!res.ok) throw new Error("data refresh failed (" + res.status + ")");
    applyDashboard(await res.json());
  }
  applyDashboard(loadDashboard());
  window.AresiumData.refresh = refresh;
})();
