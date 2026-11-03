(function () {
  const D = window.AresiumData;
  const L = window.AresiumLanguage;
  const { t, money, shortDay, open, api } = window.AresiumPages;

  function AverageLine({ side }) {
    const openFixedCosts = () => open({
      screen: "fixed",
      side
    });
    const average = D.monthlyAverage?.[side];
    const list = D.fixedCosts?.[side];
    return <div className="average-line">
      {average
        && <span
          title={L.language === "de" ? "Durchschnitt der abgeschlossenen Monate" : "Average of finished months"}>
          {t("Avg.")}
          {" "}
          {money(average.amount)}
          {" "}
          {t("a month")}
          {" · "}
        </span>}
      <button onClick={openFixedCosts}>
        {list
          ? money(list.monthlyTotal) + " " + t(side === "income" ? "regular" : "fixed")
          : t(side === "income" ? "Regular income" : "Fixed costs")}
      </button>
    </div>;
  }

  function FixedPage({ side, mutate }) {
    const list = D.fixedCosts?.[side];
    if (!list)
      return null;
    const empty = !list.running.length && !list.ended.length && !list.takenOut.length;
    return <>
      <h1>
        {t(side === "income" ? "Regular income" : "Fixed costs")}
      </h1>
      <div className="panel-total">
        {money(list.monthlyTotal)}
        {" "}
        <span className="panel-total-cap">
          {t("a month")}
        </span>
      </div>
      <p className="md-sub">
        {money(list.yearlyTotal)}
        {" "}
        {t("a year")}
      </p>
      {[["", list.running], ["Ended", list.ended], ["Not counted", list.takenOut]].map(
        ([heading, rows]) => <section key={heading}>
          {!!rows.length && heading
            && <h2 className="panel-subhead">
              {t(heading)}
            </h2>}
          {rows.map(
            (entry) => {
              const openName = () => open(
                {
                  screen: "name",
                  key: entry.newest.nameKey
                });
              const toggleFixedCost = () => mutate(
                "/api/fixed-costs",
                {
                  id: entry.id,
                  ids: entry.ids,
                  notFixed: !entry.notFixed
                });
              return (<div
                key={entry.id}
                className={"fixed-row" + (!entry.running || entry.notFixed ? " quiet" : "")}
              >
                <button
                  className="fixed-open"
                  onClick={openName}
                >
                  <span className="cat-name">
                    {entry.name}
                  </span>
                  <span
                    className="txn-amt"
                    style={{
                      color: !entry.running || entry.notFixed
                        ? "var(--ink-3)"
                        : side === "income" ? "#34E27A" : "var(--exp)"
                    }}
                  >
                    {side === "income" ? "+" : "−"}
                    {money(entry.amount, true)}
                  </span>
                  <span className="md-sub fixed-line">
                    {t(
                      {
                        monthly: "monthly",
                        quarterly: "quarterly",
                        halfYearly: "every 6 months",
                        yearly: "yearly"
                      }[entry.cadence])}
                    {" · "}
                    {entry.running && entry.nextDue >= D.today
                      ? t("next") + " " + shortDay(entry.nextDue)
                      : t("last") + " " + shortDay(entry.last)}
                    {entry.cadence !== "monthly"
                      ? " · " + money(entry.monthlyEquivalent, true) + " " + t("a month")
                      : ""}
                  </span>
                </button>
                <button
                  className="md-edit"
                  onClick={toggleFixedCost}
                >
                  {t(entry.notFixed ? "Count again" : side === "income" ? "Not regular" : "Not fixed")}
                </button>
              </div>);
            })}
        </section>)}
      {empty
        && <p className="panel-empty">
          {t(
            side === "income"
              ? "No regular income found yet. It shows up after three payments of one "
              + "name at the same interval, a yearly one after two."
              : "No fixed costs found yet. They show up after three payments of one "
              + "name at the same interval, a yearly one after two.")}
        </p>}
      <p className="recat-hint">
        {t(
          "Found in payments of the same name with about the same amount at the same interval, monthly to yearly.")}
      </p>
    </>;
  }
  Object.assign(window.AresiumViews, {
    AverageLine,
    FixedPage
  });
  Object.assign(window, {
    AverageLine
  });
})();
