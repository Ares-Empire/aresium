(function () {
  const { useState } = React;
  const D = window.AresiumData;
  const L = window.AresiumLanguage;
  const { t, money, open } = window.AresiumPages;

  function DayPage({ day, initialSide = "expenses" }) {
    const handleTouchStart = (e) => {
      gesture.current = e.touches[0].clientX;
    };
    const handleSide = (e) => {
      if (gesture.current !== null && Math.abs(e.changedTouches[0].clientX - gesture.current) > 60)
        setSide((s) => s === "expenses" ? "income" : "expenses");
      gesture.current = null;
    };
    const handleOpen = (id) => open({
      screen: "payment",
      id
    });
    const [side, setSide] = useState(initialSide);
    const month = day.slice(0, 7);
    const index = Number(day.slice(8)) - 1;
    const total = D.raw.byMonth[month]?.[side === "expenses" ? "dayExpense" : "dayIncome"][index] || 0;
    const rows = D.transactions.filter(
      (p) => p.date === day && (side === "expenses" ? p.categoriesIn : p
        .incomeBuckets).length);
    const gesture = React.useRef(null);
    return <section
      onTouchStart={handleTouchStart}
      onTouchEnd={handleSide}
    >
      <h1>
        {new Intl.DateTimeFormat(L.locale, {
          dateStyle: "full",
          timeZone: "UTC"
        }).format(new Date(day + "T12:00:00Z"))}
      </h1>
      <div className="recat-seg">
        {["expenses", "income"].map(
          (s) => <button
            key={s}
            className={"recat-seg-btn" + (s === side ? " on" : "")}
            onClick={() => setSide(s)}
          >
            {t(s === "expenses" ? "Expenses" : "Income")}
          </button>)}
      </div>
      <p className="panel-total">
        {money(total, true)}
      </p>
      {rows.length
        ? <TransactionsPanel
          txns={rows.map((p) => ({
            ...p,
            city: p.categoryName
          }))}
          onOpen={handleOpen}
        />
        : <p className="panel-empty">
          {t(side === "expenses" ? "No spending on this day." : "No income on this day.")}
        </p>}
    </section>;
  }
  Object.assign(window.AresiumViews, {
    DayPage
  });
})();
