/* Right-side contextual panels for each of the four screens. */
const fmtMoney = (v) => "€" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtMoney2 = (v) => "€" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// transition-based reveal (robust even where rAF/keyframes are throttled)
function useInP() {
  const [v, setV] = React.useState(false);
  React.useEffect(() => { const id = setTimeout(() => setV(true), 20); return () => clearTimeout(id); }, []);
  return v;
}

function PanelHeader({ kicker, title, total }) {
  return (
    <div className="panel-head">
      <div className="panel-kicker">{kicker}</div>
      <div className="panel-title">{title}</div>
      {total != null && <div className="panel-total">{fmtMoney(total)}<span className="panel-total-cap">spent</span></div>}
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
// Screen 4 : individual transactions for category × month
function TxnRow({ t, index }) {
  const shown = useInP();
  return (
    <div className={"txn-row reveal " + (shown ? "in" : "")} style={{ transitionDelay: `${index * 18}ms` }}>
      <span className="txn-day"><span className="txn-day-n">{t.day}</span></span>
      <span className="txn-main">
        <span className="txn-place">{t.place}</span>
        <span className="txn-city">{t.city}</span>
      </span>
      <span className="txn-amt">−{fmtMoney2(Math.abs(t.amount)).slice(1)}</span>
    </div>
  );
}
function TransactionsPanel({ cat, txns }) {
  return (
    <div className="panel-list">
      {txns.map((t, i) => (<TxnRow key={i} t={t} index={i} />))}
      {txns.length === 0 && <div className="panel-empty">No transactions this month.</div>}
    </div>
  );
}

Object.assign(window, { PanelHeader, CategoryListPanel, MonthListPanel, TransactionsPanel, fmtMoney });
