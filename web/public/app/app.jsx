/* Aresium — app shell: drill-down state machine, header, theme, layout. */
const { useState: useS, useEffect: useE, useCallback: useC, useMemo } = React;
const D = window.AresiumData;

const THEME_COLORS = {
  dark:  { exp: "#FF2D4B", bal: "#2E8BFF" },
  light: { exp: "#E11030", bal: "#1452F0" },
  red:   { exp: "#0a0a0a", bal: "#ffffff" },
};

// ---- screen builders: each returns chart props + panel descriptor ----
function buildScreen(state, colors) {
  const { screen, monthKey, cat } = state;
  const mo = monthKey ? D.months.find((m) => m.key === monthKey) : null;
  const dayLabels = (m) => Array.from({ length: m.days }, (_, i) => String(i + 1));
  const monthLabels = D.months.map((m) => m.short);

  if (screen === "overview") {
    return {
      title: "Overview", subtitle: `${D.months[0].label} – ${D.months[D.months.length - 1].label}`,
      chart: {
        animKey: "overview", clickable: true, xLabel: "Month", yLabel: "EUR",
        xLabels: monthLabels,
        series: [
          { key: "exp", label: "Expenses", color: colors.exp, points: D.overviewMonthExpense },
          { key: "bal", label: "Balance", color: colors.bal, points: D.overviewMonthBalance },
        ],
      },
      legend: true,
      panel: { kind: "categories", kicker: "Categories", title: "By spend", rows: D.categoryTotalsAll() },
    };
  }
  if (screen === "month") {
    return {
      title: mo.label, subtitle: "Daily expenses & balance",
      chart: {
        animKey: "month-" + monthKey, clickable: false, xLabel: "Day", yLabel: "EUR",
        xLabels: dayLabels(mo),
        series: [
          { key: "exp", label: "Expenses", color: colors.exp, points: D.dayExpenseSeries(monthKey) },
          { key: "bal", label: "Balance", color: colors.bal, points: D.dayBalanceSeries(monthKey) },
        ],
      },
      legend: true,
      panel: { kind: "categories", kicker: mo.label, title: "Categories", rows: D.categoryTotalsMonth(monthKey) },
    };
  }
  if (screen === "category") {
    const c = D.catByName[cat];
    return {
      title: `${cat} over time`, subtitle: "Monthly spend", icon: c.icon, iconColor: c.color,
      chart: {
        animKey: "cat-" + cat, clickable: true, xLabel: "Month", yLabel: "EUR",
        xLabels: monthLabels,
        series: [{ key: "exp", label: cat, color: c.color, points: D.categoryMonthSeries(cat) }],
      },
      legend: false,
      panel: { kind: "months", kicker: cat, title: "By month", cat: c, months: D.categoryMonthList(cat) },
    };
  }
  // categoryMonth
  const c = D.catByName[cat];
  return {
    title: `${cat}`, subtitle: `${mo.label} · daily`, icon: c.icon, iconColor: c.color,
    chart: {
      animKey: "catmonth-" + cat + "-" + monthKey, clickable: false, xLabel: "Day", yLabel: "EUR",
      xLabels: dayLabels(mo),
      series: [{ key: "exp", label: cat, color: c.color, fill: true, points: D.categoryDaySeries(cat, monthKey) }],
    },
    legend: false,
    panel: { kind: "txns", kicker: `${cat} · ${mo.label}`, title: "Transactions", cat: c, txns: D.categoryMonthTransactions(cat, monthKey) },
  };
}

function crumbsFor(state) {
  const out = [{ label: "Overview", to: { screen: "overview" } }];
  const mo = state.monthKey ? D.months.find((m) => m.key === state.monthKey) : null;
  if (state.screen === "month") out.push({ label: mo.label });
  if (state.screen === "category") out.push({ label: state.cat });
  if (state.screen === "categoryMonth") {
    if (state.from === "category") {
      out.push({ label: state.cat, to: { screen: "category", cat: state.cat } });
      out.push({ label: mo.label });
    } else {
      out.push({ label: mo.label, to: { screen: "month", monthKey: state.monthKey } });
      out.push({ label: state.cat });
    }
  }
  return out;
}

function Legend({ colors }) {
  return (
    <div className="legend">
      <span className="legend-item"><span className="dot" style={{ background: colors.exp }} />Expenses</span>
      <span className="legend-item"><span className="dot" style={{ background: colors.bal }} />Balance</span>
    </div>
  );
}

function SidePanel({ view, dir, pickCategory, pickMonth }) {
  const [shown, setShown] = useS(false);
  useE(() => { const id = setTimeout(() => setShown(true), 20); return () => clearTimeout(id); }, []);
  const p = view.panel;
  return (
    <div className={`panel ${dir > 0 ? "fwd" : "back"} ${shown ? "in" : ""}`}>
      <PanelHeader kicker={p.kicker} title={p.title}
        total={p.kind === "categories" ? p.rows.reduce((s, r) => s + r.total, 0) : null} />
      {p.kind === "categories" && <CategoryListPanel rows={p.rows} onPick={pickCategory} />}
      {p.kind === "months" && <MonthListPanel cat={p.cat} months={p.months} onPick={pickMonth} />}
      {p.kind === "txns" && <TransactionsPanel cat={p.cat} txns={p.txns} />}
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect x="1.5" y="1.5" width="23" height="23" rx="7" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
      <path d="M6 17 L11 9 L15 14 L20 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="6.5" r="2.1" fill="currentColor" />
    </svg>
  );
}

function App() {
  const [theme, setTheme] = useS("dark");
  const [state, setState] = useS({ screen: "overview" });
  const [dir, setDir] = useS(1); // 1 forward, -1 back
  const [history, setHistory] = useS([]);
  const [paint, setPaint] = useS(false);
  const [paintGo, setPaintGo] = useS(false);
  const prevTheme = React.useRef("dark");
  const busy = React.useRef(false);
  const colors = THEME_COLORS[theme];

  useE(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  // One continuous downward paint sweep; the theme is swapped mid-sweep (while the
  // screen is fully covered) so the UI re-colours behind the paint — no hard reload.
  const runPaint = useC((target) => {
    if (busy.current) return; busy.current = true;
    setPaint(true); setPaintGo(false);
    setTimeout(() => setPaintGo(true), 40);
    setTimeout(() => setTheme(target), 740);
    setTimeout(() => { setPaint(false); setPaintGo(false); busy.current = false; }, 1560);
  }, []);

  const toggleRed = useC(() => {
    if (theme === "red") runPaint(prevTheme.current);
    else { prevTheme.current = theme; runPaint("red"); }
  }, [theme, runPaint]);
  const onThemeBtn = useC(() => {
    if (theme === "red") { runPaint(prevTheme.current); return; }
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, [theme, runPaint]);

  const go = useC((next) => {
    setDir(1);
    setHistory((h) => [...h, state]);
    setState(next);
  }, [state]);

  const back = useC(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setDir(-1);
      setState(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const jumpTo = useC((to) => {
    // breadcrumb jump: rebuild a clean history
    setDir(-1);
    setHistory((h) => {
      const idx = h.findIndex((s) => s.screen === to.screen && s.cat === to.cat && s.monthKey === to.monthKey);
      if (idx >= 0) { setState(h[idx]); return h.slice(0, idx); }
      setState(to); return [];
    });
  }, []);

  const view = useMemo(() => buildScreen(state, colors), [state, colors]);

  // chart click handler (months on overview/category screens)
  const onIndexClick = useC((i) => {
    if (state.screen === "overview") go({ screen: "month", monthKey: D.months[i].key });
    else if (state.screen === "category") go({ screen: "categoryMonth", cat: state.cat, monthKey: D.months[i].key, from: "category" });
  }, [state, go]);

  // panel pick handlers
  const pickCategory = useC((c) => {
    if (state.screen === "overview") go({ screen: "category", cat: c.name });
    else if (state.screen === "month") go({ screen: "categoryMonth", cat: c.name, monthKey: state.monthKey, from: "month" });
  }, [state, go]);
  const pickMonth = useC((m) => go({ screen: "categoryMonth", cat: state.cat, monthKey: m.key, from: "category" }), [state, go]);

  const crumbs = crumbsFor(state);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button className="brand-btn" onClick={toggleRed} aria-label="Aresium mode" title={theme === "red" ? "Exit Aresium mode" : "Enter Aresium mode"}>
            <span className="brand-mark"><Logo /></span>
            <span className="brand-name">Aresium</span>
          </button>
          <nav className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="crumb-wrap">
                {i > 0 && <span className="crumb-sep">/</span>}
                {c.to && i < crumbs.length - 1
                  ? <button className="crumb crumb-link" onClick={() => jumpTo(c.to)}>{c.label}</button>
                  : <span className="crumb crumb-cur">{c.label}</span>}
              </span>
            ))}
          </nav>
        </div>
        <div className="actions">
          <button className="btn-back" onClick={back} disabled={history.length === 0} aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Back</span>
          </button>
          <button className="btn-theme" onClick={onThemeBtn} aria-label="Toggle theme">
            {theme === "dark" ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">{[0,45,90,135,180,225,270,315].map((a)=>{const r=a*Math.PI/180;return <line key={a} x1={12+Math.cos(r)*7} y1={12+Math.sin(r)*7} x2={12+Math.cos(r)*9.4} y2={12+Math.sin(r)*9.4}/>;})}</g></svg>
            ) : theme === "light" ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.2 6.2 0 0 0 20 14.5 Z" fill="currentColor" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 4.5 L4.5 11.5 M4.5 4.5 L11.5 11.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            )}
          </button>
        </div>
      </header>

      <main className="grid">
        <section className="chart-card">
          <div className="chart-card-head">
            <div className="chart-titles">
              <h1 className="chart-title">{view.icon ? <span className="chart-title-ic" style={{ color: view.iconColor }} dangerouslySetInnerHTML={{ __html: window.lucideSvg(view.icon) }} /> : null}{view.title}</h1>
              <p className="chart-sub">{view.subtitle}</p>
            </div>
            {view.legend && <Legend colors={colors} />}
          </div>
          <div className="chart-host">
            <AnimatedChart {...view.chart} animKey={view.chart.animKey + "-" + theme} theme={theme} onIndexClick={onIndexClick} />
          </div>
        </section>

        <aside className="side-card">
          <SidePanel key={view.chart.animKey} view={view} dir={dir}
            pickCategory={pickCategory} pickMonth={pickMonth} />
        </aside>
      </main>

      {theme === "red" && (
        <div className="aresium-band" aria-hidden="true">
          <div className="aresium-word">{"ARESIUM".split("").map((ch, i) => <span key={i}>{ch}</span>)}</div>
        </div>
      )}

      {paint && <div className={"paint" + (paintGo ? " go" : "")} aria-hidden="true" />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
