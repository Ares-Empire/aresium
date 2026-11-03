/* Right-side contextual panels for each of the four screens. */
const fmtMoney = (v) => new Intl.NumberFormat(
  window.AresiumLanguage?.locale || "en-GB",
  {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(v);
const fmtMoney2 = (v) => new Intl.NumberFormat(
  window.AresiumLanguage?.locale || "en-GB",
  {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(v);
const INC_GREEN = "#34E27A";
// transition-based reveal (robust even where rAF/keyframes are throttled)
function useInP() {
  const [v, setV] = React.useState(false);
  React.useEffect(
    () => {
      const id = setTimeout(() => setV(true), 20);
      return () => clearTimeout(id);
    },
    []);
  return v;
}
function PanelHeader({ kicker, title, total, cap }) {
  return (
    <div className="panel-head">
      <div className="panel-kicker">
        {kicker}
      </div>
      <div className="panel-title">
        {window.AresiumLanguage.t(title)}
      </div>
      {total != null
        && <div className="panel-total">
          {fmtMoney(total)}
          <span className="panel-total-cap">
            {cap || "spent"}
          </span>
        </div>}
    </div>
  );
}
function CategoryRow({ c, max, onClick, index }) {
  const pct = max > 0 ? (c.total / max) * 100 : 0;
  const shown = useInP();
  return (
    <button
      className={"cat-row reveal " + (shown ? "in" : "")}
      onClick={onClick}
      style={{
        transitionDelay: `${index * 22}ms`
      }}
    >
      <span
        className="cat-icon"
        style={{
          background: c.color + "1f",
          color: c.color,
          border: "1px solid " + c.color + "33"
        }}
        dangerouslySetInnerHTML={{
          __html: window.lucideSvg(c.icon)
        }}
      />
      <span className="cat-main">
        <span className="cat-name">
          {window.AresiumPages?.t(c.name === "Uncategorised" ? "Not sorted" : c.name) || c.name}
        </span>
        <span className="cat-bar">
          <span
            className="cat-bar-fill"
            style={{
              width: pct + "%",
              background: c.color
            }}
          />
        </span>
      </span>
      <span className="cat-amt">
        {fmtMoney(c.total)}
      </span>
      <span className="cat-chev">
        {"›"}
      </span>
    </button>
  );
}
// Screen 1 + 2 : list of categories (whole range, or one month)
function CategoryListPanel({ rows, onPick }) {
  const handleClick = () => window.AresiumPages.open({
    screen: "quickSort"
  });
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <div className="panel-list">
      {rows.some((c) => c.name === "Uncategorised")
        && <button
          className="md-edit"
          onClick={handleClick}
        >
          {window.AresiumPages.t("Go through not sorted")}
        </button>}
      {rows.map(
        (c, i) => (
          <CategoryRow
            key={c.name}
            c={c}
            max={max}
            index={i}
            onClick={() => onPick(c)}
          />
        ))}
      {rows.length === 0
        && <div className="panel-empty">
          {window.AresiumLanguage.t("No spending recorded.")}
        </div>}
    </div>
  );
}
// Screen 3 : list of months for a category
function MonthRow({ cat, m, max, onPick, index }) {
  const pct = max > 0 ? (m.total / max) * 100 : 0;
  const shown = useInP();
  return (
    <button
      className={"cat-row reveal " + (shown ? "in" : "")}
      onClick={() => onPick(m)}
      style={{
        transitionDelay: `${index * 22}ms`
      }}
    >
      <span
        className="cat-icon"
        style={{
          background: cat.color + "1f",
          color: cat.color,
          border: "1px solid " + cat.color + "33"
        }}
        dangerouslySetInnerHTML={{
          __html: window.lucideSvg(cat.icon)
        }}
      />
      <span className="cat-main">
        <span className="cat-name">
          {m.label}
        </span>
        <span className="cat-bar">
          <span
            className="cat-bar-fill"
            style={{
              width: pct + "%",
              background: cat.color
            }}
          />
        </span>
      </span>
      <span className="cat-amt">
        {fmtMoney(m.total)}
      </span>
      <span className="cat-chev">
        {"›"}
      </span>
    </button>
  );
}
function MonthListPanel({ cat, months, onPick }) {
  const max = months.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <div className="panel-list">
      {months.map(
        (m, i) => (<MonthRow
          key={m.key}
          cat={cat}
          m={m}
          max={max}
          onPick={onPick}
          index={i}
        />))}
      {months.length === 0
        && <div className="panel-empty">
          {window.AresiumLanguage.t("No spending recorded.")}
        </div>}
    </div>
  );
}
// Screen 4 : individual transactions for category × month.
// Clickable → opens the full detail modal (only when we have a real DB id; the
// offline mock has none, so it stays a static row there).
function TxnRow({ t, index, onOpen }) {
  const shown = useInP();
  return (
    <button
      className={"txn-row reveal " + (shown ? "in" : "") + (t.id ? " clickable" : "")}
      style={{
        transitionDelay: `${index * 18}ms`
      }}
      onClick={() => t.id && onOpen(t.id)}
      disabled={!t.id}
    >
      <span className="txn-day">
        <span className="txn-day-n">
          {t.day}
          {"."}
        </span>
      </span>
      <span className="txn-main">
        <span className="txn-place">
          {t.place}
          {t.tagged
            && <span
              className="txn-tag-badge"
              title={"Added here · counted in " + t.categoryName}
            >
              {"tag"}
            </span>}
        </span>
        <span className="txn-city">
          {t.city}
          {t.counted !== undefined
            && (t.city ? " · " : "") + window.AresiumPages.t("Original amount") + ": "
            + window.AresiumPages.money(t.amount, true)}
        </span>
      </span>
      <span
        className="txn-amt"
        style={{
          color: (t.counted ?? t.amount) < 0 ? "var(--exp)" : INC_GREEN
        }}
      >
        {t.amount < 0 ? "−" : "+"}
        {window.AresiumPages.money(Math.abs(t.counted ?? t.amount), true)}
      </span>
    </button>
  );
}
function TransactionsPanel({ cat, txns, onOpen }) {
  const handleSelecting = () => {
    setSelecting((v) => !v);
    setSelected([]);
  };
  const handleSelected = () => setSelected(selected.length === selectable.length ? [] : selectable.map((p) => p.id));
  const handleClick = () => window.AresiumPages.open({
    screen: "batchCategory",
    ids: selected
  });
  const handleClick2 = () => window.AresiumPages.open(
    {
      screen: "rename",
      ids: selected.filter((id) => !txns.find((p) => p.id === id)?.receiptId)
    });
  const handleClick3 = () => window.AresiumPages.open({
    screen: "payback",
    ids: selected
  });
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState([]);
  const [sumPrefs, setSumPrefs] = React.useState(() => window.AresiumDisplay.getSums());
  const summaryKey = cat && txns[0]
    ? JSON.stringify([cat.name, txns[0].month, txns[0].amount > 0 ? "income" : "spend"])
    : null;
  const sums = summaryKey ? window.AresiumData.raw.summedLists?.[summaryKey] : null;
  const grouped = (g) => !sumPrefs.excluded.includes(cat?.name)
    && (sumPrefs.all || sumPrefs.categories.includes(cat?.name) || sumPrefs.names.includes(g.key));
  const summing = !!sums?.some((g) => grouped(g));
  const toggleSums = () => window.AresiumDisplay.setSums(
    {
      ...sumPrefs,
      categories: summing
        ? sumPrefs.categories.filter((c) => c !== cat.name)
        : [...new Set([...sumPrefs.categories, cat.name])],
      excluded: summing
        ? [...new Set([...sumPrefs.excluded, cat.name])]
        : sumPrefs.excluded.filter((c) => c !== cat.name)
    });
  React.useEffect(
    () => {
      const fn = () => setSumPrefs(window.AresiumDisplay.getSums());
      window.addEventListener("aresium:display", fn);
      return () => window.removeEventListener("aresium:display", fn);
    },
    []);
  React.useEffect(
    () => {
      const fn = () => {
        setSelected([]);
        setSelecting(false);
      };
      window.addEventListener("aresium:selection-done", fn);
      return () => window.removeEventListener("aresium:selection-done", fn);
    },
    []);
  const last = React.useRef(null);
  const tr = window.AresiumPages.t;
  const selectable = txns.filter((p) => !p.coveredBy);
  const toggle = (index, event) => {
    const id = txns[index].id;
    const value = !selected.includes(id);
    const start = event.shiftKey && last.current !== null ? Math.min(last.current, index) : index;
    const end = event.shiftKey && last.current !== null ? Math.max(last.current, index) : index;
    const ids = txns.slice(start, end + 1).filter((p) => !p.coveredBy).map((p) => p.id);
    setSelected((old) => value ? [...new Set([...old, ...ids])] : old.filter((id) => !ids.includes(id)));
    last.current = index;
  };
  return <div className="panel-list">
    <div className="selection-tools">
      {sums
        && <button
          className="md-edit"
          aria-pressed={summing}
          onClick={toggleSums}
        >
          {tr(summing ? "Show payments" : "Add up names")}
        </button>}
      <button
        className="md-edit"
        onClick={handleSelecting}
      >
        {tr(selecting ? "Done" : "Select")}
      </button>
      {selecting
        && <>
          <button
            className="md-edit"
            onClick={handleSelected}
          >
            {tr(selected.length === selectable.length ? "Clear selection" : "Select all")}
          </button>
          <span>
            {selected.length}
          </span>
          <button
            className="md-edit"
            disabled={!selected.length}
            onClick={handleClick}
          >
            {tr("Category")}
          </button>
          <button
            className="md-edit"
            disabled={!selected.some((id) => !txns.find((p) => p.id === id)?.receiptId)}
            onClick={handleClick2}
          >
            {tr("Name")}
          </button>
          <button
            className="md-edit"
            disabled={!selected.length}
            onClick={handleClick3}
          >
            {tr("Money paid back")}
          </button>
        </>}
    </div>
    {summing && sums
      ? sums.map(
        (group) => {
          const handleSelected = (e) => setSelected(
            (old) => e.target.checked
              ? [...new Set([...old, ...group.ids])]
              : old.filter((id) => !group.ids.includes(id)));
          const handleClick = () => window.AresiumPages.open(
            {
              screen: "name",
              key: group.key,
              month: txns[0].month
            });
          return (!group.covered && !grouped(group)
            ? group.ids.map(
              (id) => {
                const p = txns.find((p) => p.id === id);
                const index = txns.indexOf(p);
                return <div
                  className="selection-row"
                  key={id}
                >
                  {selecting
                    && <input
                      type="checkbox"
                      aria-label={tr("Select") + " " + p.place}
                      checked={selected.includes(id)}
                      onClick={(e) => toggle(index, e)}
                      onChange={() => { }}
                    />}
                  <TxnRow
                    t={p}
                    index={index}
                    onOpen={onOpen}
                  />
                </div>;
              })
            : <div
              className="selection-row"
              key={group.key}
            >
              {selecting
                && <input
                  type="checkbox"
                  disabled={group.covered}
                  checked={group.ids.length > 0 && group.ids.every((id) => selected.includes(id))}
                  aria-label={tr("Select") + " " + group.name}
                  onChange={handleSelected}
                />}
              <button
                className="name-result"
                disabled={group.covered}
                onClick={handleClick}
              >
                <span>
                  {group.name}
                  <small>
                    {group.count}
                    {" "}
                    {tr("Payments")}
                  </small>
                </span>
                <span>
                  {window.AresiumPages.money(group.amount, true)}
                </span>
              </button>
            </div>);
        })
      : txns.map(
        (p, i) => <div
          className="selection-row"
          key={p.id || i}
        >
          {selecting
            && <input
              type="checkbox"
              disabled={!!p.coveredBy}
              aria-label={tr("Select") + " " + p.place + " " + p.date}
              checked={selected.includes(p.id)}
              onClick={(e) => toggle(i, e)}
              onChange={() => { }}
            />}
          <TxnRow
            t={p}
            index={i}
            onOpen={onOpen}
          />
        </div>)}
    {!txns.length && <div className="panel-empty">
      {tr("No matching payments.")}
    </div>}
  </div>;
}
// Combined month panel: spending categories + income sources (general → month).
function MonthCombinedPanel({ rows, incomeRows, onPickExpense, onPickIncome }) {
  const eMax = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const iMax = incomeRows.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <div className="panel-list">
      <div className="panel-subhead">
        {window.AresiumLanguage.t("Spending")}
      </div>
      {rows.length
        ? rows.map(
          (c, i) => (<CategoryRow
            key={"e" + c.name}
            c={c}
            max={eMax}
            index={i}
            onClick={() => onPickExpense(c)}
          />))
        : <div className="panel-empty sm">
          {window.AresiumLanguage.t("No spending this month.")}
        </div>}
      <div className="panel-subhead income">
        {window.AresiumLanguage.t("Income")}
      </div>
      {incomeRows.length
        ? incomeRows.map(
          (c, i) => (<CategoryRow
            key={"i" + c.name}
            c={c}
            max={iMax}
            index={i}
            onClick={() => onPickIncome(c)}
          />))
        : <div className="panel-empty sm">
          {window.AresiumLanguage.t("No income this month.")}
        </div>}
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
      <div
        className="panel-tabs"
        role="tablist"
      >
        <button
          className={"panel-tab" + (active === "expenses" ? " on" : "")}
          role="tab"
          aria-selected={active === "expenses"}
          onClick={() => onTab("expenses")}
        >
          {window.AresiumLanguage.t("Expenses")}
        </button>
        <button
          className={"panel-tab" + (active === "income" ? " on" : "")}
          role="tab"
          aria-selected={active === "income"}
          onClick={() => onTab("income")}
        >
          {window.AresiumLanguage.t("Income")}
        </button>
      </div>
      <div className="panel-head tabbed">
        {kicker ? <div className="panel-kicker">
          {kicker}
        </div> : null}
        <div className="panel-total">
          {fmtMoney(total)}
          <span className="panel-total-cap">
            {active === "income" ? "received" : "spent"}
          </span>
        </div>
      </div>
      <div className="panel-list">
        {rows.length
          ? rows.map(
            (c, i) => (<CategoryRow
              key={c.name}
              c={c}
              max={max}
              index={i}
              onClick={() => onPick(c)}
            />))
          : <div className="panel-empty">
            {"No "}
            {active === "income" ? "income" : "spending"}
            {" recorded."}
          </div>}
      </div>
    </React.Fragment>
  );
}
// ---- Single-transaction detail modal ----------------------------------------
function TxnDetailModal({ id, onClose, onChanged }) {
  const handleClick = () => window.AresiumPages.open(
    window.AresiumData.transactions.find((p) => p.id === data.id)?.receiptId
      ? {
        screen: "cashEdit",
        id: data.id
      }
      : {
        screen: "rename",
        ids: [data.id]
      });
  const handleClick2 = () => window.AresiumPages.open(
    {
      screen: "name",
      key: window.AresiumData.transactions.find((p) => p.id === data.id)?.nameKey
    });
  const handleClick3 = () => window.AresiumPages.open(
    {
      screen: "batchCategory",
      ids: [data.id]
    });
  const [data, setData] = React.useState(null);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(
    () => {
      const fn = () => setRevision((v) => v + 1);
      window.addEventListener("aresium:data", fn);
      return () => window.removeEventListener("aresium:data", fn);
    },
    []);
  const [err, setErr] = React.useState(false);
  const [recat, setRecat] = React.useState(false); // separate recategorise window open?
  React.useEffect(
    () => {
      if (!id)
        return;
      setData(null);
      setErr(false);
      setRecat(false);
      let alive = true;
      fetch(
        "/api/transaction/" + encodeURIComponent(id),
        {
          headers: {
            "Accept-Language": window.AresiumLanguage?.language || "en"
          }
        })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d) => {
          if (alive)
            setData(d);
        })
        .catch(() => {
          if (alive)
            setErr(true);
        });
      return () => {
        alive = false;
      };
    },
    [id, revision]);
  React.useEffect(
    () => {
      if (!id)
        return;
      const onKey = (e) => {
        if (e.key === "Escape")
          onClose();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    },
    [id, onClose]);
  if (!id)
    return null;
  // Called by the separate recategorise window after a successful Switch/Add: refresh the
  // detail shown here and let the app patch its in-memory copy + re-aggregate every screen.
  const onApplied = (d) => {
    setData(d);
    if (onChanged)
      onChanged(d);
  };
  // Picker shows only the side that matches the item: a positive (income) txn moves among
  // income categories, a negative (expense) txn among spending ones. The server decides the
  // choices and their order (`pick` in /api/data, docs/API-DATA.md).
  const D2 = window.AresiumData || {};
  const isIncomeItem = !!(data && data.amount > 0);
  const pickList = data && D2.pick
    ? (isIncomeItem ? D2.pick.income : D2.pick.spend).map((n) => D2.catByName[n]).filter(Boolean)
    : [];
  const rows = data
    ? [
      ["Source", data.source],
      ["Booking date", data.bookingDate],
      ["Value date", data.valueDate],
      ["Balance after", data.balance != null ? fmtMoney2(data.balance) : null],
      ["Counterparty", data.counterparty],
      ["Description", data.description],
      ["Location", [data.city, data.country].filter(Boolean).join(", ") || null],
      ["Trip", data.trip ? (data.trip + (data.tripKind ? " (" + data.tripKind + ")" : "")) : null],
      ["Place type", (data.placeType && data.placeType !== "unknown") ? data.placeType : null],
      ["Recurring", data.recurring ? window.AresiumLanguage.t("Yes") : null],
      ["External ID", data.externalId],
    ].filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];
  return (
    <React.Fragment>
      <div
        className="modal-overlay"
        onClick={onClose}
      >
        <div
          className="modal-card"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="modal-close"
            onClick={onClose}
            aria-label={window.AresiumLanguage.t("Close")}
          >
            {"✕"}
          </button>
          {!data && !err
            && <div className="md-state">
              {window.AresiumLanguage.t("Loading…")}
            </div>}
          {err
            && <div className="md-state">
              {window.AresiumLanguage.t("Couldn’t load this transaction.")}
            </div>}
          {data
            && (
              <React.Fragment>
                <div className="modal-head">
                  <button
                    className="md-place"
                    onClick={handleClick}
                  >
                    {window.AresiumData.transactions.find((p) => p.id === data.id)?.place || data.place}
                    {" "}
                    <span className="md-edit">
                      {window.AresiumPages.t("Rename")}
                    </span>
                  </button>
                  <p className="md-sub">
                    {window.AresiumData.transactions.find((p) => p.id === data.id)?.bankName || data.counterparty}
                  </p>
                  <button
                    className="md-edit"
                    onClick={handleClick2}
                  >
                    {window.AresiumPages.t("All with this name")}
                  </button>
                  <div
                    className="md-amt"
                    style={{
                      color: data.amount < 0 ? "var(--exp)" : "#34E27A"
                    }}
                  >
                    {data.amount < 0 ? "−" : "+"}
                    {window.AresiumPages.money(Math.abs(data.amount), true)}
                    {data.currency && data.currency !== "EUR" ? " " + data.currency : ""}
                  </div>
                  <div className="md-date">
                    {window.AresiumPages.formatDay(data.bookingDate)}
                  </div>
                  <window.PaybackDetail id={data.id} />
                </div>
                <div className="modal-grid">
                  <div className="md-row">
                    <span className="md-label">
                      {window.AresiumLanguage.t("Category")}
                    </span>
                    <span className="md-value">
                      <span className="md-cat-display">
                        <span
                          className="md-chip"
                          style={{
                            color: data.categoryColor,
                            background: data.categoryColor + "1f",
                            border: "1px solid " + data.categoryColor + "33"
                          }}
                        >
                          {data.category}
                        </span>
                        {data.categorySource
                          ? <span className="md-sub">
                            {" via "}
                            {data.categorySource}
                          </span>
                          : null}
                        {pickList.length > 0
                          && <button
                            className="md-edit"
                            onClick={handleClick3}
                          >
                            {window.AresiumLanguage.t("Change")}
                          </button>}
                      </span>
                    </span>
                  </div>
                  {data.tags && data.tags.length > 0
                    && (
                      <div className="md-row">
                        <span className="md-label">
                          {window.AresiumLanguage.t("Also in")}
                        </span>
                        <span className="md-value">
                          <span className="md-cat-display">
                            {data.tags.map(
                              (nm) => {
                                const tc = (window.AresiumData && window.AresiumData.catByName
                                  && window
                                    .AresiumData.catByName[nm])
                                  || {};
                                const col = tc.color || data.categoryColor;
                                return <span
                                  key={nm}
                                  className="md-chip md-chip-tag"
                                  style={{
                                    color: col,
                                    background: col + "16",
                                    border: "1px solid " + col + "33"
                                  }}
                                >
                                  {nm}
                                </span>;
                              })}
                          </span>
                        </span>
                      </div>
                    )}
                  {data.account
                    && (
                      <div className="md-row">
                        <span className="md-label">
                          {window.AresiumLanguage.t("Account")}
                        </span>
                        <span className="md-value">
                          {data.account}
                          {data.iban
                            ? <span className="md-sub">
                              {" · "}
                              {data.iban}
                            </span>
                            : null}
                        </span>
                      </div>
                    )}
                  {rows.map(
                    ([label, value]) => (
                      <div
                        className="md-row"
                        key={label}
                      >
                        <span className="md-label">
                          {window.AresiumLanguage.t(label)}
                        </span>
                        <span className="md-value">
                          {["Booking date", "Value date"].includes(label)
                            ? window.AresiumPages.formatDay(
                              value)
                            : value}
                        </span>
                      </div>
                    ))}
                </div>
                {data.raw && typeof data.raw === "object"
                  && (
                    <details className="modal-raw">
                      <summary>
                        {window.AresiumLanguage.t("Original record")}
                        {" · "}
                        {data.source}
                      </summary>
                      <div className="md-raw-grid">
                        {Object.entries(data.raw).map(
                          ([k, v]) => (
                            <div
                              className="md-raw-row"
                              key={k}
                            >
                              <span className="md-raw-k">
                                {k}
                              </span>
                              <span className="md-raw-v">
                                {v === null || v === "" ? "—" : String(v)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
              </React.Fragment>
            )}
        </div>
      </div>
      {recat && data
        && (
          <RecategorizeModal
            data={data}
            pickList={pickList}
            isIncomeItem={isIncomeItem}
            onClose={() => setRecat(false)}
            onApplied={onApplied}
          />
        )}
    </React.Fragment>
  );
}
// ---- Separate recategorise window (opens on top of the detail modal) ---------
// One window, one segmented toggle:
//   Switch — the txn is in the wrong category; move it to a single new one.
//   Add    — keep it where it is but also surface it under other categories. The money is
//            never double-counted (its primary category still owns it for all totals); the
//            extra categories just also list it. "Save & remove from current" instead moves
//            it out of its current category entirely, into the selected ones.
function RecategorizeModal({ data, pickList, isIncomeItem, onClose, onApplied }) {
  const handleClick = () => {
    if (!saving)
      onClose();
  };
  const [mode, setMode] = React.useState("switch"); // "switch" | "add"
  const [target, setTarget] = React.useState(null); // switch: chosen category name
  const [extras, setExtras] = React.useState(() => new Set(data.tags || [])); // add: selected extra categories
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(false);
  React.useEffect(
    () => {
      const onKey = (e) => {
        if (e.key === "Escape" && !saving)
          onClose();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    },
    [onClose, saving]);
  const current = data.category;
  const toggleExtra = (name) => setExtras(
    (s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  const submit = (url, body) => {
    setSaving(true);
    setErr(false);
    fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": window.AresiumLanguage?.language || "en"
        },
        body: JSON.stringify(body)
      })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        onApplied(d);
        onClose();
      })
      .catch(() => {
        setErr(true);
        setSaving(false);
      });
  };
  const doSwitch = () => {
    if (!target || target === current)
      return;
    submit(
      "/api/transaction/" + encodeURIComponent(data.id) + "/category",
      {
        category: target
      });
  };
  const doAdd = (dropCurrent) => {
    const categories = [...extras];
    if (dropCurrent && categories.length === 0)
      return;
    submit(
      "/api/transaction/" + encodeURIComponent(data.id) + "/tags",
      {
        categories,
        dropCurrent
      });
  };
  const switchReady = !!target && target !== current;
  const addExtras = [...extras].filter((n) => n !== current);
  return (
    <div
      className="recat-overlay"
      onClick={handleClick}
    >
      <div
        className="recat-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          className="modal-close"
          onClick={onClose}
          aria-label={window.AresiumLanguage.t("Close")}
          disabled={saving}
        >
          {"✕"}
        </button>
        <div className="recat-head">
          <div className="recat-place">
            {data.place}
          </div>
          <div className="recat-cur">
            <span className="md-sub">
              {window.AresiumLanguage.t("Currently in")}
            </span>
            <span
              className="md-chip"
              style={{
                color: data.categoryColor,
                background: data.categoryColor + "1f",
                border: "1px solid " + data.categoryColor + "33"
              }}
            >
              {current}
            </span>
          </div>
        </div>
        <div
          className="recat-seg"
          role="tablist"
          aria-label="Mode"
        >
          <button
            className={"recat-seg-btn" + (mode === "switch" ? " on" : "")}
            role="tab"
            aria-selected={mode === "switch"}
            onClick={() => setMode("switch")}
          >
            {window.AresiumLanguage.t("Switch")}
          </button>
          <button
            className={"recat-seg-btn" + (mode === "add" ? " on" : "")}
            role="tab"
            aria-selected={mode === "add"}
            onClick={() => setMode("add")}
          >
            {window.AresiumLanguage.t("Add")}
          </button>
        </div>
        <div className="recat-hint">
          {mode === "switch"
            ? "Wrong category? Pick the one it belongs in — it moves there."
            : "Also show this under other categories. It stays counted once (in " + current
            + "), so nothing is double-counted."}
        </div>
        <div className="recat-grid">
          {pickList.map(
            (c) => {
              const isCurrent = c.name === current;
              const selected = mode === "switch" ? c.name === target : extras.has(c.name);
              const onClick = mode === "switch"
                ? () => setTarget(c.name)
                : () => {
                  if (!isCurrent)
                    toggleExtra(c.name);
                };
              return (
                <button
                  key={c.name}
                  disabled={saving || (mode === "add" && isCurrent)}
                  className={"recat-pick" + (selected ? " sel" : "") + (isCurrent ? " cur" : "")}
                  style={{
                    color: c.color,
                    borderColor: c.color + (selected ? "" : "55"),
                    background: c.color + (selected ? "2a" : "14")
                  }}
                  onClick={onClick}
                >
                  <span
                    className="md-pick-ic"
                    dangerouslySetInnerHTML={{
                      __html: window.lucideSvg(c.icon)
                    }}
                  />
                  <span className="md-pick-nm">
                    {window.AresiumPages?.t(c.name === "Uncategorised" ? "Not sorted" : c.name) || c.name}
                  </span>
                  {isCurrent
                    && <span className="recat-tag-badge">
                      {window.AresiumLanguage.t("current")}
                    </span>}
                  {!isCurrent && selected
                    && <span
                      className="recat-check"
                      aria-hidden="true"
                    >
                      {"✓"}
                    </span>}
                </button>
              );
            })}
        </div>
        {err
          && <div className="recat-err">
            {window.AresiumDemo
              ? "This is the demo with sample data: changes are switched off."
              : "Couldn’t save — please try again."}
          </div>}
        <div className="recat-actions">
          <button
            className="recat-btn ghost"
            onClick={onClose}
            disabled={saving}
          >
            {window.AresiumLanguage.t("Cancel")}
          </button>
          {mode === "switch"
            ? (
              <button
                className="recat-btn primary"
                onClick={doSwitch}
                disabled={saving || !switchReady}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            )
            : (
              <React.Fragment>
                <button
                  className="recat-btn danger"
                  onClick={() => doAdd(true)}
                  disabled={saving || addExtras.length === 0}
                  title="Move this transaction out of its current category and into the selected ones"
                >
                  Save & remove from current
                </button>
                <button
                  className="recat-btn primary"
                  onClick={() => doAdd(false)}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </React.Fragment>
            )}
        </div>
      </div>
    </div>
  );
}
// The privacy policy and imprint, on the hub (one controller runs every Empire site). English like the rest of the
// website, same tab as on the hub's login page; used by the desktop (app.jsx) and the phone layout (mobile.jsx).
function LegalLinks({ className }) {
  return (
    <footer className={className}>
      <a href="https://www.ares-empire.de/privacy">
        {window.AresiumLanguage.t("Privacy")}
      </a>
      {" · "}
      <a href="https://www.ares-empire.de/imprint">
        {window.AresiumLanguage.t("Imprint")}
      </a>
    </footer>
  );
}
Object.assign(
  window,
  {
    PanelHeader,
    CategoryListPanel,
    MonthListPanel,
    TransactionsPanel,
    MonthCombinedPanel,
    TabbedPanel,
    TxnDetailModal,
    LegalLinks,
    fmtMoney
  });
