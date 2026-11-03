(function () {
  const { useState } = React;
  const D = window.AresiumData;
  const { t, money, shortDay, open, api, useDirtyGuard } = window.AresiumPages;
  const NewCategory = window.AresiumViews.NewCategory;

  function CashPage() {
    const [month, setMonth] = useState(D.months.at(-1)?.key || "");
    const cash = D.raw.cash;
    const totals = cash?.months[month];
    return <>
      <h1>
        {t("Cash")}
      </h1>
      <button
        className="recat-btn primary"
        onClick={() => open({
          screen: "cashEdit"
        })}
      >
        {t("Add cash")}
      </button>
      <label className="page-field">
        {t("Month")}
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {D.months.map(
            (m) => <option
              key={m.key}
              value={m.key}
            >
              {m.label}
            </option>)}
        </select>
      </label>
      {totals
        && <div className="name-totals">
          {[
            ["Cash withdrawn", totals.withdrawn],
            ["Cash received", totals.received],
            ["Cash spent", totals.spent],
            ["Cash without receipts", totals.unaccounted]
          ].map(
            ([label, value]) => <p key={label}>
              {t(label)}
              {" "}
              <b>
                {money(value, true)}
              </b>
            </p>)}
        </div>}
      {(cash?.movements || []).filter((p) => p.date.startsWith(month)).slice().reverse().map(
        (p) => {
          const handleClick = () => open(
            p.kind === "withdrawal"
              ? {
                screen: "payment",
                id: p.id
              }
              : {
                screen: "cashEdit",
                id: p.id
              });
          return (<button
            key={p.id}
            className="name-result"
            onClick={handleClick}
          >
            <span>
              {p.place}
              <small>
                {shortDay(p.date)}
                {" · "}
                {p.category}
              </small>
            </span>
            <span>
              {money(p.amount, true)}
              {p.left !== null
                && <small>
                  {money(p.left, true)}
                  {" "}
                  {t("rest")}
                </small>}
            </span>
          </button>);
        })}
      {!cash?.movements.length
        && <p className="panel-empty">
          {t("No cash entries yet.")}
        </p>}
    </>;
  }

  function CashEditor({ id, mutate }) {
    const saveCashEntry = (e) => {
      e.preventDefault();
      mutate(
        "/api/cash",
        {
          action: id ? "edit" : "create",
          id,
          shop,
          date: day,
          total: Number(total.replace(",", ".")),
          direction,
          category: category || null,
          paidFrom: paidFrom || null
        });
    };
    const changeDirection = (e) => {
      setDirection(e.target.value);
      setCategory("");
    };
    const deleteCashEntry = () => mutate("/api/cash", {
      action: "delete",
      id
    });
    const entry = D.raw.cashEntries?.find((p) => p.id === id);
    const [shop, setShop] = useState(entry?.shop || "");
    const [day, setDay] = useState(entry?.date || D.today);
    const [total, setTotal] = useState(entry ? String(entry.total) : "");
    const [direction, setDirection] = useState(entry?.direction || "out");
    const [category, setCategory] = useState(entry?.category || "");
    const [paidFrom, setPaidFrom] = useState(entry?.paidFrom || "");
    useDirtyGuard(
      shop !== (entry?.shop || "") || day !== (entry?.date || D.today)
      || total !== (entry ? String(entry.total) : "")
      || direction !== (entry?.direction || "out")
      || category !== (entry?.category || "")
      || paidFrom !== (entry?.paidFrom || ""));
    const choices = D.pick[direction === "in" ? "income" : "spend"].filter((name) => D.catByName[name]
 ?.kind !== "transfer");
    return <>
      <h1>
        {t(id ? "Edit" : "Add cash")}
      </h1>
      <form
        onSubmit={saveCashEntry}>
        <label className="page-field">
          {t("Name")}
          <input
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            required
            maxLength={60}
          />
        </label>
        <label className="page-field">
          {t("Date")}
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </label>
        <label className="page-field">
          {t("Amount")}
          <input
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            required
          />
        </label>
        <label className="page-field">
          {t("Cash")}
          <select
            value={direction}
            onChange={changeDirection}
          >
            <option value="out">
              {t("Cash spent")}
            </option>
            <option value="in">
              {t("Cash received")}
            </option>
          </select>
        </label>
        <label className="page-field">
          {t("Category")}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">
              {t("Not sorted")}
            </option>
            {choices.map((name) => <option key={name}>
              {name}
            </option>)}
          </select>
        </label>
        <NewCategory
          side={direction === "in" ? "income" : "spend"}
          mutate={mutate}
          onCreated={(c) => setCategory(c.name)}
        />
        {direction === "out"
          && <label className="page-field">
            {t("Paid from")}
            <select
              value={paidFrom}
              onChange={(e) => setPaidFrom(e.target.value)}
            >
              <option value="">
                {t("Automatic")}
              </option>
              {(D.raw.cash?.movements || []).filter((p) => p.amount > 0 && p.id !== id).map(
                (p) => <option
                  key={p.id}
                  value={p.id}
                >
                  {p.place}
                  {" · "}
                  {shortDay(p.date)}
                </option>)}
            </select>
          </label>}
        <button className="recat-btn primary">
          {t("Save")}
        </button>
        {id
          && <button
            type="button"
            className="recat-btn danger"
            onClick={deleteCashEntry}
          >
            {t("Delete")}
          </button>}
      </form>
    </>;
  }
  Object.assign(window.AresiumViews, {
    CashPage,
    CashEditor
  });
})();
