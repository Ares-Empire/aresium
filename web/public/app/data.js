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

    return {
      categories, catByName, months, transactions, balanceByDay, openingBalance,
      monthExpense, monthEndBalance, dayExpenseSeries, dayBalanceSeries,
      categoryMonthSeries, categoryDaySeries, categoryTotalsAll, categoryTotalsMonth,
      categoryMonthList, categoryMonthTransactions,
      overviewMonthExpense: months.map((mo) => monthExpense(mo.key)),
      overviewMonthBalance: months.map((mo) => monthEndBalance(mo.key)),
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

  window.AresiumData = buildAresiumData(loadSource());
})();
