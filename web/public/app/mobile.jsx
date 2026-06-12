/* Aresium — mobile (phone) version.

   A separate component tree for narrow screens — NOT a reflow of the desktop grid.
   The desktop layout (graph + two side panels) doesn't shrink to a phone, so phones
   get their own flow: a swipeable Expenses/Income category wall, a Current/Overview
   range toggle, an optional revealing graph, and drill-down to months → activities.

   It shares everything that already exists: the data layer (window.AresiumData), the
   morphing chart (AnimatedChart), the list/detail panels (CategoryListPanel,
   MonthListPanel, TransactionsPanel), and the recategorise modal (TxnDetailModal).

   Wrapped in an IIFE so its locals don't collide with the other Babel scripts (which
   share one global lexical scope); it exposes only window.MobileApp, which app.jsx's
   device-routing Root mounts below the ~620px breakpoint. */
(function () {
  const { useState, useEffect, useRef, useCallback, useMemo } = React;
  const D = window.AresiumData;
  const { CategoryListPanel, MonthListPanel, TransactionsPanel, TxnDetailModal, fmtMoney } = window;
  const AnimatedChart = window.AnimatedChart;
  const lucideSvg = window.lucideSvg;

  const INC = "#34E27A"; // income green
  const THEME_COLORS = {
    dark:  { exp: "#FF2D4B", bal: "#2E8BFF" },
    light: { exp: "#E11030", bal: "#1452F0" },
    red:   { exp: "#0a0a0a", bal: "#ffffff" },
  };

  const months = D.months;
  const curKey = months[months.length - 1].key;       // "current" = latest month with data
  const monthShorts = months.map((m) => m.short);
  const dayLabels = (key) => {
    const mo = months.find((m) => m.key === key);
    return Array.from({ length: mo.days }, (_, i) => String(i + 1));
  };

  function MobLogo() {
    return (
      <svg width="24" height="24" viewBox="0 0 26 26" fill="none">
        <rect x="1.5" y="1.5" width="23" height="23" rx="7" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
        <path d="M6 17 L11 9 L15 14 L20 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="6.5" r="2.1" fill="currentColor" />
      </svg>
    );
  }

  // One side's category wall (Expenses or Income) — header with the side total, then
  // the reused CategoryListPanel. Two of these live in the swipe track side-by-side.
  function StartPage({ side, name, cap, rows, color, rangeLabel, onPick }) {
    const total = rows.reduce((s, r) => s + r.total, 0);
    return (
      <div className="mob-page">
        <div className="mob-page-head">
          <div className="mob-page-kicker">{rangeLabel}</div>
          <div className="mob-side-row">
            <span className="mob-side-name" style={{ color }}>{name}</span>
            <span className="mob-side-total">{fmtMoney(total)}<span className="mob-side-cap">{cap}</span></span>
          </div>
        </div>
        <CategoryListPanel rows={rows} onPick={(c) => onPick(side, c)} />
      </div>
    );
  }

  // Swipeable Expenses ↔ Income. Horizontal drags slide the track; vertical drags fall
  // through to the list's native scroll (touch-action: pan-y + an axis-lock on first move).
  function StartSwipe({ side, setSide, expRows, incRows, colors, rangeLabel, onPick }) {
    const wrapRef = useRef(null);
    const [pageW, setPageW] = useState(0);
    const [drag, setDrag] = useState(0);
    const [dragging, setDragging] = useState(false);
    const g = useRef({ x: 0, y: 0, axis: null, id: null });

    useEffect(() => {
      const el = wrapRef.current; if (!el) return;
      const ro = new ResizeObserver(() => setPageW(el.clientWidth));
      ro.observe(el); setPageW(el.clientWidth);
      return () => ro.disconnect();
    }, []);

    const onDown = (e) => { g.current = { x: e.clientX, y: e.clientY, axis: null, id: e.pointerId }; setDragging(true); };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - g.current.x, dy = e.clientY - g.current.y;
      if (g.current.axis === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          g.current.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
          if (g.current.axis === "h") { try { e.currentTarget.setPointerCapture(g.current.id); } catch (_) {} }
        }
      }
      if (g.current.axis === "h") {
        // rubber-band past the ends so there's nowhere to swipe to
        let d = dx;
        if (side === "expenses" && d > 0) d *= 0.3;
        if (side === "income" && d < 0) d *= 0.3;
        setDrag(d);
      }
    };
    const onUp = () => {
      if (!dragging) return;
      const th = Math.max(28, pageW * 0.1);
      if (g.current.axis === "h") {
        if (drag < -th && side === "expenses") setSide("income");
        else if (drag > th && side === "income") setSide("expenses");
      }
      setDragging(false); setDrag(0); g.current.axis = null;
    };

    const base = side === "income" ? -pageW : 0;
    return (
      <div ref={wrapRef} className="mob-swipe"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className={"mob-track" + (dragging ? " drag" : "")} style={{ transform: `translateX(${base + drag}px)` }}>
          <StartPage side="expenses" name="Expenses" cap="spent" rows={expRows} color={colors.exp} rangeLabel={rangeLabel} onPick={onPick} />
          <StartPage side="income" name="Income" cap="received" rows={incRows} color={INC} rangeLabel={rangeLabel} onPick={onPick} />
        </div>
      </div>
    );
  }

  function MobileChart({ chart, theme, iv }) {
    return (
      <AnimatedChart {...chart} animKey={chart.animKey + "-" + theme + "-i" + (iv || 0)} theme={theme} />
    );
  }

  function MobileApp() {
    const [theme, setTheme] = useState("dark");
    const [nav, setNav] = useState({ screen: "start" });
    const [hist, setHist] = useState([]);
    const [side, setSide] = useState("expenses");      // start-screen swipe page
    const [range, setRange] = useState("current");     // current month vs all-time
    const [graphOn, setGraphOn] = useState(false);     // reveal the chart
    const [detailId, setDetailId] = useState(null);
    const [dataVer, setDataVer] = useState(0);
    const [importVer, setImportVer] = useState(0);     // bump after an upload to morph/re-reveal
    const [upload, setUpload] = useState(null);        // { busy } | { msg, ok } | null
    const fileRef = useRef(null);
    const prevTheme = useRef("dark");
    const busy = useRef(false);
    const colors = THEME_COLORS[theme];

    useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
    useEffect(() => { window.AresiumPaint && window.AresiumPaint.prewarm(); }, []);

    // One downward poured-paint sweep (window.AresiumPaint); theme swapped while the
    // sheet covers the screen (onCovered) so the UI re-colours behind it.
    const runPaint = useCallback((target) => {
      if (busy.current) return; busy.current = true;
      window.AresiumPaint.pour({
        onCovered: () => setTheme(target),
        onDone: () => { busy.current = false; },
      });
    }, []);
    const toggleRed = useCallback(() => {
      if (theme === "red") runPaint(prevTheme.current);
      else { prevTheme.current = theme; runPaint("red"); }
    }, [theme, runPaint]);
    const onThemeBtn = useCallback(() => {
      if (theme === "red") { runPaint(prevTheme.current); return; }
      setTheme((t) => (t === "dark" ? "light" : "dark"));
    }, [theme, runPaint]);

    const go = useCallback((n) => { setHist((h) => [...h, nav]); setNav(n); }, [nav]);
    const back = useCallback(() => {
      setHist((h) => { if (!h.length) return h; setNav(h[h.length - 1]); return h.slice(0, -1); });
    }, []);

    const pickFromStart = useCallback((s, c) => go({ screen: "category", cat: c.name, income: s === "income" }), [go]);
    const pickMonth = useCallback((m) => go({ screen: "categoryMonth", cat: nav.cat, income: nav.income, monthKey: m.key }), [go, nav]);
    const pickGraphMonth = useCallback((i) => go({ screen: "categoryMonth", cat: nav.cat, income: nav.income, monthKey: months[i].key }), [go, nav]);

    // Upload bank/PayPal exports → server ingests + categorises → refresh + morph.
    const openUpload = useCallback(() => { if (fileRef.current) fileRef.current.click(); }, []);
    const onUploadPick = useCallback(async (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      setUpload({ busy: true });
      try {
        const data = await window.AresiumUpload.send(files);
        await window.AresiumData.refresh();
        setImportVer((v) => v + 1);
        setDataVer((v) => v + 1);
        setUpload({ msg: window.AresiumUpload.summarize(data), ok: true });
      } catch (err) {
        setUpload({ msg: (err && err.message) || "Import failed", ok: false });
      } finally {
        if (fileRef.current) fileRef.current.value = "";
        setTimeout(() => setUpload((u) => (u && u.busy ? u : null)), 4600);
      }
    }, []);

    // After an inline recategorise: patch the in-memory txn + re-aggregate everywhere.
    const onRecat = useCallback((id, newCat) => {
      const arr = D.transactions;
      if (arr) { const t = arr.find((x) => x.id === id); if (t) t.categoryName = newCat; }
      setDataVer((v) => v + 1);
    }, []);

    // ---- derive the rows / chart for the current screen ----
    const expRows = useMemo(() => (range === "current" ? D.categoryTotalsMonth(curKey) : D.categoryTotalsAll()), [range, dataVer]);
    const incRows = useMemo(() => (range === "current" ? D.incomeTotalsMonth(curKey) : D.incomeTotalsAll()), [range, dataVer]);
    const rangeLabel = range === "current"
      ? months[months.length - 1].label
      : `${months[0].label} – ${months[months.length - 1].label}`;

    const startChart = useMemo(() => {
      const isInc = side === "income";
      const color = isInc ? INC : colors.exp;
      if (range === "current") {
        return { animKey: `mst-cur-${side}-${curKey}`, xLabel: "Day", yLabel: "EUR", clickable: false, xLabels: dayLabels(curKey),
          series: [{ key: "v", label: isInc ? "Income" : "Expenses", color, fill: true, points: isInc ? D.incomeDaySeries(curKey) : D.dayExpenseSeries(curKey) }] };
      }
      return { animKey: `mst-ov-${side}`, xLabel: "Month", yLabel: "EUR", clickable: false, xLabels: monthShorts,
        series: [{ key: "v", label: isInc ? "Income" : "Expenses", color, fill: true, points: isInc ? D.overviewMonthIncome : D.overviewMonthExpense }] };
    }, [side, range, colors.exp, dataVer]);

    const catMeta = nav.cat ? (nav.income ? D.incomeBucketMeta(nav.cat) : D.catByName[nav.cat]) : null;
    const catMonths = useMemo(() => (nav.screen === "category"
      ? (nav.income ? D.incomeBucketMonthList(nav.cat) : D.categoryMonthList(nav.cat)) : []), [nav, dataVer]);
    const catChart = useMemo(() => {
      if (nav.screen !== "category" || !catMeta) return null;
      return { animKey: `mcat-${nav.income ? "i" : "e"}-${nav.cat}`, xLabel: "Month", yLabel: "EUR", clickable: true, xLabels: monthShorts,
        series: [{ key: "v", label: nav.cat, color: catMeta.color, fill: true, points: nav.income ? D.incomeBucketMonthSeries(nav.cat) : D.categoryMonthSeries(nav.cat) }] };
    }, [nav, dataVer]);
    const catTxns = useMemo(() => (nav.screen === "categoryMonth"
      ? (nav.income ? D.incomeBucketMonthTransactions(nav.cat, nav.monthKey) : D.categoryMonthTransactions(nav.cat, nav.monthKey)) : []), [nav, dataVer]);

    const canBack = hist.length > 0;
    const showControls = nav.screen === "start" || nav.screen === "category";
    const mo = nav.monthKey ? months.find((m) => m.key === nav.monthKey) : null;

    // header title/subtitle per screen
    let title = null, subtitle = null;
    if (nav.screen === "category") { title = nav.cat; subtitle = nav.income ? "Monthly income" : "Monthly spend"; }
    else if (nav.screen === "categoryMonth") { title = nav.cat; subtitle = `${mo.label} · activities`; }

    return (
      <div className="mobile-app">
        <header className="mob-top">
          {canBack ? (
            <button className="mob-icon-btn" onClick={back} aria-label="Back">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : (
            <span className="mob-brand" aria-hidden="true"><span className="mob-brand-mark"><MobLogo /></span></span>
          )}
          <div className="mob-head-title">
            {title ? (
              <React.Fragment>
                <div className="mob-h1">
                  {catMeta ? <span className="mob-h1-ic" style={{ color: catMeta.color }} dangerouslySetInnerHTML={{ __html: lucideSvg(catMeta.icon) }} /> : null}
                  <span className="mob-h1-tx">{title}</span>
                </div>
                <div className="mob-h2">{subtitle}</div>
              </React.Fragment>
            ) : (
              <div className="mob-h1"><span className="mob-h1-tx">Aresium</span></div>
            )}
          </div>
          <div className="mob-top-right">
            <button className="mob-icon-btn" onClick={onThemeBtn} aria-label="Toggle theme">
              {theme === "dark" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">{[0,45,90,135,180,225,270,315].map((a)=>{const r=a*Math.PI/180;return <line key={a} x1={12+Math.cos(r)*7} y1={12+Math.sin(r)*7} x2={12+Math.cos(r)*9.4} y2={12+Math.sin(r)*9.4}/>;})}</g></svg>
              ) : theme === "light" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.2 6.2 0 0 0 20 14.5 Z" fill="currentColor" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 4.5 L4.5 11.5 M4.5 4.5 L11.5 11.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
              )}
            </button>
            <button className="mob-icon-btn" onClick={() => { window.location.href = "/logout"; }} aria-label="Log out">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M14 4 H7 a2 2 0 0 0 -2 2 v12 a2 2 0 0 0 2 2 h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M17 8 l4 4 -4 4 M21 12 H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </header>

        {showControls && (
          <div className="mob-controls">
            {nav.screen === "start" ? (
              <div className="modeseg" role="tablist" aria-label="Range">
                <button className={"modeseg-btn" + (range === "current" ? " on" : "")} onClick={() => setRange("current")}>Current</button>
                <button className={"modeseg-btn" + (range === "overview" ? " on" : "")} onClick={() => setRange("overview")}>Overview</button>
              </div>
            ) : <span />}
            <div className="mob-ctl-right">
              <input ref={fileRef} type="file" accept=".csv,.xml" multiple style={{ display: "none" }} onChange={onUploadPick} />
              <button className={"mob-icon-btn mob-import-btn" + (upload && upload.busy ? " busy" : "")} onClick={openUpload} disabled={!!(upload && upload.busy)} aria-label="Import statements">
                {upload && upload.busy
                  ? <span className="mob-spin" aria-hidden="true" />
                  : <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 10.5 V2.5 M8 2.5 L5 5.5 M8 2.5 L11 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 11 V13 H13 V11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
              <button className={"mob-icon-btn mob-graph-btn" + (graphOn ? " on" : "")} onClick={() => setGraphOn((v) => !v)} aria-pressed={graphOn} aria-label="Toggle graph">
                <span dangerouslySetInnerHTML={{ __html: lucideSvg("TrendingUp") }} />
              </button>
            </div>
          </div>
        )}

        <main className="mob-main">
          {nav.screen === "start" && (
            <React.Fragment>
              <div className={"mob-graph" + (graphOn ? " on" : "")}>
                <div className="mob-graph-host">{graphOn && <MobileChart chart={startChart} theme={theme} iv={importVer} />}</div>
              </div>
              <div className="mob-dots" role="tablist" aria-label="Side">
                <button className={"mob-dot" + (side === "expenses" ? " on" : "")} onClick={() => setSide("expenses")} aria-label="Expenses" />
                <button className={"mob-dot" + (side === "income" ? " on" : "")} onClick={() => setSide("income")} aria-label="Income" />
              </div>
              <StartSwipe key={"sw-i" + importVer} side={side} setSide={setSide} expRows={expRows} incRows={incRows} colors={colors} rangeLabel={rangeLabel} onPick={pickFromStart} />
            </React.Fragment>
          )}

          {nav.screen === "category" && (
            <div className="mob-drill">
              {graphOn
                ? <div className="mob-cat-graph"><MobileChart chart={{ ...catChart, onIndexClick: pickGraphMonth }} theme={theme} iv={importVer} /></div>
                : <MonthListPanel cat={catMeta} months={catMonths} onPick={pickMonth} />}
            </div>
          )}

          {nav.screen === "categoryMonth" && (
            <div className="mob-drill">
              <TransactionsPanel cat={catMeta} txns={catTxns} onOpen={setDetailId} />
            </div>
          )}
        </main>

        <button className="mob-band" onClick={toggleRed} aria-label={theme === "red" ? "Exit Aresium mode" : "Enter Aresium mode"}>
          <div className="aresium-word" aria-hidden="true">{"ARESIUM".split("").map((ch, i) => <span key={i}>{ch}</span>)}</div>
        </button>

        <TxnDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={onRecat} />
        {upload && !upload.busy && (
          <div className={"import-toast " + (upload.ok ? "ok" : "err")} role="status">{upload.msg}</div>
        )}
      </div>
    );
  }

  window.MobileApp = MobileApp;
})();
