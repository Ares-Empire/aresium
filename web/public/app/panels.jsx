/* Right-side contextual panels for each of the four screens. */
const fmtMoney = (v) => "€" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtMoney2 = (v) => "€" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INC_GREEN = "#34E27A";

// transition-based reveal (robust even where rAF/keyframes are throttled)
function useInP() {
  const [v, setV] = React.useState(false);
  React.useEffect(() => { const id = setTimeout(() => setV(true), 20); return () => clearTimeout(id); }, []);
  return v;
}

function PanelHeader({ kicker, title, total, cap }) {
  return (
    <div className="panel-head">
      <div className="panel-kicker">{kicker}</div>
      <div className="panel-title">{title}</div>
      {total != null && <div className="panel-total">{fmtMoney(total)}<span className="panel-total-cap">{cap || "spent"}</span></div>}
    </div>
  );
}

function CategoryRow({ c, max, onClick, index }) {
  const pct = max > 0 ? (c.total / max) * 100 : 0;
  const shown = useInP();
  return (
    <button className={"cat-row reveal " + (shown ? "in" : "")} onClick={onClick} style={{ transitionDelay: `${index * 22}ms` }}>
      <span className="cat-icon" style={{ background: c.color + "1f", color: c.color, border: "1px solid " + c.color + "33" }} dangerouslySetInnerHTML={{ __html: window.lucideSvg(c.icon) }} />
      <span className="cat-main">
        <span className="cat-name">{c.name}</span>
        <span className="cat-bar"><span className="cat-bar-fill" style={{ width: pct + "%", background: c.color }} /></span>
      </span>
      <span className="cat-amt">{fmtMoney(c.total)}</span>
      <span className="cat-chev">›</span>
    </button>
  );
}

// Screen 1 + 2 : list of categories (whole range, or one month)
function CategoryListPanel({ rows, onPick }) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <div className="panel-list">
      {rows.map((c, i) => (
        <CategoryRow key={c.name} c={c} max={max} index={i} onClick={() => onPick(c)} />
      ))}
      {rows.length === 0 && <div className="panel-empty">No spending recorded.</div>}
    </div>
  );
}

// Screen 3 : list of months for a category
function MonthRow({ cat, m, max, onPick, index }) {
  const pct = max > 0 ? (m.total / max) * 100 : 0;
  const shown = useInP();
  return (
    <button className={"cat-row reveal " + (shown ? "in" : "")} onClick={() => onPick(m)} style={{ transitionDelay: `${index * 22}ms` }}>
      <span className="cat-icon" style={{ background: cat.color + "1f", color: cat.color, border: "1px solid " + cat.color + "33" }} dangerouslySetInnerHTML={{ __html: window.lucideSvg(cat.icon) }} />
      <span className="cat-main">
        <span className="cat-name">{m.label}</span>
        <span className="cat-bar"><span className="cat-bar-fill" style={{ width: pct + "%", background: cat.color }} /></span>
      </span>
      <span className="cat-amt">{fmtMoney(m.total)}</span>
      <span className="cat-chev">›</span>
    </button>
  );
}
function MonthListPanel({ cat, months, onPick }) {
  const max = months.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <div className="panel-list">
      {months.map((m, i) => (<MonthRow key={m.key} cat={cat} m={m} max={max} onPick={onPick} index={i} />))}
      {months.length === 0 && <div className="panel-empty">No spending recorded.</div>}
    </div>
  );
}
// Screen 4 : individual transactions for category × month.
// Clickable → opens the full detail modal (only when we have a real DB id; the
// offline mock has none, so it stays a static row there).
function TxnRow({ t, index, onOpen }) {
  const shown = useInP();
  return (
    <button className={"txn-row reveal " + (shown ? "in" : "") + (t.id ? " clickable" : "")}
      style={{ transitionDelay: `${index * 18}ms` }}
      onClick={() => t.id && onOpen(t.id)} disabled={!t.id}>
      <span className="txn-day"><span className="txn-day-n">{t.day}</span></span>
      <span className="txn-main">
        <span className="txn-place">{t.place}</span>
        <span className="txn-city">{t.city}</span>
      </span>
      <span className="txn-amt" style={{ color: t.amount < 0 ? "var(--exp)" : INC_GREEN }}>
        {t.amount < 0 ? "−" : "+"}{fmtMoney2(Math.abs(t.amount)).slice(1)}
      </span>
    </button>
  );
}
function TransactionsPanel({ cat, txns, onOpen }) {
  return (
    <div className="panel-list">
      {txns.map((t, i) => (<TxnRow key={t.id || i} t={t} index={i} onOpen={onOpen} />))}
      {txns.length === 0 && <div className="panel-empty">No transactions this month.</div>}
    </div>
  );
}

// Combined month panel: spending categories + income sources (general → month).
function MonthCombinedPanel({ rows, incomeRows, onPickExpense, onPickIncome }) {
  const eMax = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const iMax = incomeRows.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <div className="panel-list">
      <div className="panel-subhead">Spending</div>
      {rows.length ? rows.map((c, i) => (<CategoryRow key={"e" + c.name} c={c} max={eMax} index={i} onClick={() => onPickExpense(c)} />))
        : <div className="panel-empty sm">No spending this month.</div>}
      <div className="panel-subhead income">Income</div>
      {incomeRows.length ? incomeRows.map((c, i) => (<CategoryRow key={"i" + c.name} c={c} max={iMax} index={i} onClick={() => onPickIncome(c)} />))
        : <div className="panel-empty sm">No income this month.</div>}
    </div>
  );
}

// Right-side panel with Expenses/Income tabs (overview + month). Each tab shows its
// own total and category list; switching tabs swaps the list, not the graph.
function TabbedPanel({ kicker, active, onTab, expenseRows, incomeRows, onPickExpense, onPickIncome }) {
  const rows = active === "income" ? incomeRows : expenseRows;
  const onPick = active === "income" ? onPickIncome : onPickExpense;
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <React.Fragment>
      <div className="panel-tabs" role="tablist">
        <button className={"panel-tab" + (active === "expenses" ? " on" : "")} role="tab" aria-selected={active === "expenses"} onClick={() => onTab("expenses")}>Expenses</button>
        <button className={"panel-tab" + (active === "income" ? " on" : "")} role="tab" aria-selected={active === "income"} onClick={() => onTab("income")}>Income</button>
      </div>
      <div className="panel-head tabbed">
        {kicker ? <div className="panel-kicker">{kicker}</div> : null}
        <div className="panel-total">{fmtMoney(total)}<span className="panel-total-cap">{active === "income" ? "received" : "spent"}</span></div>
      </div>
      <div className="panel-list">
        {rows.length ? rows.map((c, i) => (<CategoryRow key={c.name} c={c} max={max} index={i} onClick={() => onPick(c)} />))
          : <div className="panel-empty">No {active === "income" ? "income" : "spending"} recorded.</div>}
      </div>
    </React.Fragment>
  );
}

// ---- Single-transaction detail modal ----------------------------------------
function TxnDetailModal({ id, onClose, onChanged }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;
    setData(null); setErr(false); setEditing(false);
    let alive = true;
    fetch("/api/transaction/" + encodeURIComponent(id))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  React.useEffect(() => {
    if (!id) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!id) return null;

  const changeCategory = (name) => {
    if (saving || !data || name === data.category) { setEditing(false); return; }
    setSaving(true);
    fetch("/api/transaction/" + encodeURIComponent(data.id) + "/category", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: name }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setData(d); setEditing(false); if (onChanged) onChanged(d.id, d.category); })
      .catch(() => {})
      .finally(() => setSaving(false));
  };
  // Picker shows only the side that matches the item: a positive (income) txn
  // moves among income categories, a negative (expense) txn among spending ones —
  // each in the same order as its tab.
  const D2 = window.AresiumData || {};
  const allCats = D2.categories || [];
  const isIncomeItem = !!(data && data.amount > 0);
  const incomeKeep = new Set(["Tax"]);
  allCats.forEach((c) => { if (c.kind === "income" || c.kind === "transfer") incomeKeep.add(c.name); });
  const orderNames = (data
    ? (isIncomeItem ? (D2.incomeTotalsAll ? D2.incomeTotalsAll() : []) : (D2.categoryTotalsAll ? D2.categoryTotalsAll() : []))
    : []).map((r) => r.name);
  const pickList = (data ? allCats.filter((c) => (isIncomeItem ? incomeKeep.has(c.name) : c.kind === "spend")) : [])
    .slice().sort((a, b) => {
      const ia = orderNames.indexOf(a.name), ib = orderNames.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1; if (ib !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

  const rows = data ? [
    ["Source", data.source],
    ["Booking date", data.bookingDate],
    ["Value date", data.valueDate],
    ["Balance after", data.balance != null ? fmtMoney2(data.balance) : null],
    ["Counterparty", data.counterparty],
    ["Description", data.description],
    ["Location", [data.city, data.country].filter(Boolean).join(", ") || null],
    ["Trip", data.trip ? (data.trip + (data.tripKind ? " (" + data.tripKind + ")" : "")) : null],
    ["Place type", (data.placeType && data.placeType !== "unknown") ? data.placeType : null],
    ["Recurring", data.recurring ? "Yes" : null],
    ["External ID", data.externalId],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "") : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        {!data && !err && <div className="md-state">Loading…</div>}
        {err && <div className="md-state">Couldn’t load this transaction.</div>}
        {data && (
          <React.Fragment>
            <div className="modal-head">
              <div className="md-place">{data.place}</div>
              <div className="md-amt" style={{ color: data.amount < 0 ? "var(--exp)" : "var(--bal)" }}>
                {data.amount < 0 ? "−" : "+"}{fmtMoney2(Math.abs(data.amount)).slice(1)}{data.currency && data.currency !== "EUR" ? " " + data.currency : ""}
              </div>
              <div className="md-date">{data.bookingDate}</div>
            </div>
            <div className="modal-grid">
              <div className="md-row">
                <span className="md-label">Category</span>
                <span className="md-value">
                  {!editing ? (
                    <span className="md-cat-display">
                      <span className="md-chip" style={{ color: data.categoryColor, background: data.categoryColor + "1f", border: "1px solid " + data.categoryColor + "33" }}>{data.category}</span>
                      {data.categorySource ? <span className="md-sub"> via {data.categorySource}</span> : null}
                      {pickList.length > 0 && <button className="md-edit" onClick={() => setEditing(true)}>Change</button>}
                    </span>
                  ) : (
                    <div className="md-picker">
                      <div className="md-picker-head">Move to {isIncomeItem ? "income" : "spending"} category</div>
                      <div className="md-picker-grid">
                        {pickList.map((c) => (
                          <button key={c.name} disabled={saving}
                            className={"md-pick" + (c.name === data.category ? " cur" : "")}
                            style={{ color: c.color, borderColor: c.color + "55", background: c.color + "14" }}
                            onClick={() => changeCategory(c.name)}>
                            <span className="md-pick-ic" dangerouslySetInnerHTML={{ __html: window.lucideSvg(c.icon) }} />
                            <span className="md-pick-nm">{c.name}</span>
                          </button>
                        ))}
                      </div>
                      <button className="md-pick-cancel-btn" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                  )}
                </span>
              </div>
              {data.account && (
                <div className="md-row">
                  <span className="md-label">Account</span>
                  <span className="md-value">{data.account}{data.iban ? <span className="md-sub"> · {data.iban}</span> : null}</span>
                </div>
              )}
              {rows.map(([label, value]) => (
                <div className="md-row" key={label}>
                  <span className="md-label">{label}</span>
                  <span className="md-value">{value}</span>
                </div>
              ))}
            </div>
            {data.raw && typeof data.raw === "object" && (
              <details className="modal-raw">
                <summary>Original {data.source} record</summary>
                <div className="md-raw-grid">
                  {Object.entries(data.raw).map(([k, v]) => (
                    <div className="md-raw-row" key={k}>
                      <span className="md-raw-k">{k}</span>
                      <span className="md-raw-v">{v === null || v === "" ? "—" : String(v)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { PanelHeader, CategoryListPanel, MonthListPanel, TransactionsPanel, MonthCombinedPanel, TabbedPanel, TxnDetailModal, fmtMoney });
