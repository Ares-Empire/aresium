/* Aresium — data layer.
   Builds window.AresiumData (the only thing the UI reads) from a flat source:
     { categories:[{name,icon,color,kind}], months:[{key,label,short,year,month,days,partial}],
       transactions:[{date,amount,categoryName,place,city}], balanceByDay:{ymd:bal}, openingBalance }
   The source comes from the live backend (GET /api/data → real Postgres data); if that
   isn't reachable (e.g. the file opened directly with no server) it falls back to the
   generated mock in data.mock.js. Aggregation logic is identical for both, so the dashboard
   automatically reflects whatever has been imported + categorised. */
(function () {
  "use strict";
  const money = (n) => Math.round(n * 100) / 100;
  const pad = (n) => String(n).padStart(2, "0");

  function buildAresiumData(src) {
    const { categories, months, transactions, balanceByDay, openingBalance } = src;
    const catByName = {};
    categories.forEach((c) => (catByName[c.name] = c));

    const spendCats = categories.filter((c) => c.kind === "spend").map((c) => c.name);
    const isSpend = (n) => catByName[n] && catByName[n].kind === "spend";
    const monthOf = (date) => date.slice(0, 7);

    function monthExpense(key) {
      let s = 0;
      transactions.forEach((t) => { if (monthOf(t.date) === key && isSpend(t.categoryName)) s += -t.amount; });
      return money(s);
    }
    function monthEndBalance(key) {
      const mo = months.find((x) => x.key === key);
      return mo ? balanceByDay[`${key}-${pad(mo.days)}`] : 0;
    }
    function dayExpenseSeries(key) {
      const mo = months.find((x) => x.key === key);
      const arr = new Array(mo.days).fill(0);
      transactions.forEach((t) => {
        if (monthOf(t.date) === key && isSpend(t.categoryName)) {
          const d = parseInt(t.date.slice(8), 10);
          if (d >= 1 && d <= mo.days) arr[d - 1] += -t.amount;
        }
      });
      return arr.map(money);
    }
    function dayBalanceSeries(key) {
      const mo = months.find((x) => x.key === key);
      const arr = [];
      for (let d = 1; d <= mo.days; d++) arr.push(balanceByDay[`${key}-${pad(d)}`] ?? 0);
      return arr;
    }
    function categoryMonthSeries(cat) {
      return months.map((mo) => {
        let s = 0;
        transactions.forEach((t) => { if (monthOf(t.date) === mo.key && t.categoryName === cat) s += -t.amount; });
        return money(Math.max(0, s));
      });
    }
    function categoryDaySeries(cat, key) {
      const mo = months.find((x) => x.key === key);
      const arr = new Array(mo.days).fill(0);
      transactions.forEach((t) => {
        if (monthOf(t.date) === key && t.categoryName === cat) {
          const d = parseInt(t.date.slice(8), 10);
          if (d >= 1 && d <= mo.days) arr[d - 1] += -t.amount;
        }
      });
      return arr.map((v) => money(Math.max(0, v)));
    }
    function categoryTotalsAll() {
      const totals = {};
      spendCats.forEach((n) => (totals[n] = 0));
      transactions.forEach((t) => { if (isSpend(t.categoryName)) totals[t.categoryName] += -t.amount; });
      return spendCats.map((n) => ({ ...catByName[n], total: money(totals[n]) }))
        .filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
    }
    function categoryTotalsMonth(key) {
      const totals = {};
      spendCats.forEach((n) => (totals[n] = 0));
      transactions.forEach((t) => { if (monthOf(t.date) === key && isSpend(t.categoryName)) totals[t.categoryName] += -t.amount; });
      return spendCats.map((n) => ({ ...catByName[n], total: money(totals[n]) }))
        .filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
    }
    function categoryMonthList(cat) {
      const series = categoryMonthSeries(cat);
      return months.map((mo, i) => ({ ...mo, total: series[i] })).filter((m) => m.total > 0);
    }
    function categoryMonthTransactions(cat, key) {
      return transactions.filter((t) => monthOf(t.date) === key && t.categoryName === cat)
        .map((t) => ({ ...t, day: parseInt(t.date.slice(8), 10) }))
        .sort((a, b) => a.day - b.day);
    }

    // ---- income side (positive amounts) -------------------------------------
    // Bucketing: income/transfer categories (+ Tax) keep their own bucket; a
    // positive amount in a spend category is a "Refunds"; uncategorised → "Other".
    const INCOME_META = {
      Refunds: { name: "Refunds", icon: "RotateCcw", color: "#34E27A", kind: "income" },
      Other: { name: "Other", icon: "CircleHelp", color: "#9AA6B8", kind: "income" },
    };
    const incomeKeep = new Set(["Tax"]);
    categories.forEach((c) => { if (c.kind === "income" || c.kind === "transfer") incomeKeep.add(c.name); });
    function incomeBucketOf(t) {
      const n = t.categoryName;
      if (!n || n === "Uncategorised") return "Other";
      return incomeKeep.has(n) ? n : "Refunds";
    }
    function incomeBucketMeta(name) { return catByName[name] || INCOME_META[name] || { name, icon: "Tag", color: "#34E27A", kind: "income" }; }
    function incomeMonth(key) {
      let s = 0;
      transactions.forEach((t) => { if (monthOf(t.date) === key && t.amount > 0) s += t.amount; });
      return money(s);
    }
    function incomeDaySeries(key) {
      const mo = months.find((x) => x.key === key);
      const arr = new Array(mo.days).fill(0);
      transactions.forEach((t) => {
        if (monthOf(t.date) === key && t.amount > 0) {
          const d = parseInt(t.date.slice(8), 10);
          if (d >= 1 && d <= mo.days) arr[d - 1] += t.amount;
        }
      });
      return arr.map(money);
    }
    function incomeTotals(filterKey) {
      const totals = {};
      transactions.forEach((t) => {
        if (t.amount > 0 && (!filterKey || monthOf(t.date) === filterKey)) {
          const b = incomeBucketOf(t); totals[b] = (totals[b] || 0) + t.amount;
        }
      });
      return Object.keys(totals).map((n) => ({ ...incomeBucketMeta(n), total: money(totals[n]) })).sort((a, b) => b.total - a.total);
    }
    function incomeBucketMonthSeries(bucket) {
      return months.map((mo) => {
        let s = 0;
        transactions.forEach((t) => { if (monthOf(t.date) === mo.key && t.amount > 0 && incomeBucketOf(t) === bucket) s += t.amount; });
        return money(s);
      });
    }
    function incomeBucketDaySeries(bucket, key) {
      const mo = months.find((x) => x.key === key);
      const arr = new Array(mo.days).fill(0);
      transactions.forEach((t) => {
        if (monthOf(t.date) === key && t.amount > 0 && incomeBucketOf(t) === bucket) {
          const d = parseInt(t.date.slice(8), 10);
          if (d >= 1 && d <= mo.days) arr[d - 1] += t.amount;
        }
      });
      return arr.map(money);
    }
    function incomeBucketMonthList(bucket) {
      const series = incomeBucketMonthSeries(bucket);
      return months.map((mo, i) => ({ ...mo, total: series[i] })).filter((m) => m.total > 0);
    }
    function incomeBucketMonthTransactions(bucket, key) {
      return transactions.filter((t) => monthOf(t.date) === key && t.amount > 0 && incomeBucketOf(t) === bucket)
        .map((t) => ({ ...t, day: parseInt(t.date.slice(8), 10) }))
        .sort((a, b) => a.day - b.day);
    }

    return {
      categories, catByName, months, transactions, balanceByDay, openingBalance,
      monthExpense, monthEndBalance, dayExpenseSeries, dayBalanceSeries,
      categoryMonthSeries, categoryDaySeries, categoryTotalsAll, categoryTotalsMonth,
      categoryMonthList, categoryMonthTransactions,
      incomeBucketOf, incomeBucketMeta, incomeDaySeries,
      incomeTotalsAll: () => incomeTotals(null), incomeTotalsMonth: (k) => incomeTotals(k),
      incomeBucketMonthSeries, incomeBucketDaySeries, incomeBucketMonthList, incomeBucketMonthTransactions,
      overviewMonthExpense: months.map((mo) => monthExpense(mo.key)),
      overviewMonthBalance: months.map((mo) => monthEndBalance(mo.key)),
      overviewMonthIncome: months.map((mo) => incomeMonth(mo.key)),
    };
  }

  // Load the source synchronously so window.AresiumData exists before the Babel-compiled
  // React modules evaluate (they read it at module scope). Self-hosted single-user tool,
  // same-origin, tiny payload — a blocking GET here is the simplest correct option.
  function loadSource() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/api/data", false);
      xhr.send(null);
      if (xhr.status === 200) {
        const src = JSON.parse(xhr.responseText);
        if (src && src.transactions && src.transactions.length) return src;
      }
    } catch (e) { /* no server / file:// — fall back */ }
    return window.AresiumMockSource;
  }

  // Build, then copy the result *onto* the existing window.AresiumData object (rather
  // than replacing it) so the reference captured at module scope by app.jsx/mobile.jsx
  // stays live. `refresh` is preserved across rebuilds.
  function applySource(src) {
    const built = buildAresiumData(src);
    if (!window.AresiumData) window.AresiumData = {};
    Object.keys(window.AresiumData).forEach((k) => {
      if (k !== "refresh" && !(k in built)) delete window.AresiumData[k];
    });
    Object.assign(window.AresiumData, built);
  }

  // Re-pull live data after an import and rebuild in place. Callers bump their React
  // version state afterwards so every screen re-aggregates + morphs to the new totals.
  async function refresh() {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.ok) throw new Error("data refresh failed (" + res.status + ")");
    applySource(await res.json());
  }

  applySource(loadSource());
  window.AresiumData.refresh = refresh;
})();
