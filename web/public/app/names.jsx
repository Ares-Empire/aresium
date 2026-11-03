(function () {
  const { useState, useEffect } = React;
  const D = window.AresiumData;
  const { t, money, shortDay, open, api, useDirtyGuard } = window.AresiumPages;

  function SearchPage() {
    const [query, setQuery] = useState("");
    const results = query.trim()
      ? window.AresiumSearch.search(query, D.nameGroups)
      : Object.values(D.nameGroups).sort((a, b) => b.newestDate.localeCompare(a.newestDate)).slice(0, 8);
    return <>
      <h1>
        {t("Search")}
      </h1>
      <label className="page-field">
        {t("Name")}
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {results.map(
        (group) => {
          const handleClick = () => open({
            screen: "name",
            key: group.key
          });
          return (<button
            className="name-result"
            key={group.key}
            onClick={handleClick}
          >
            <span>
              <b>
                {group.name}
              </b>
              <small>
                {group.count}
                {" · "}
                {shortDay(group.newestDate)}
                {group.matchedName ? " · " + t("Bank name") + ": " + group.matchedName : ""}
              </small>
            </span>
            <span>
              {money(group.moneyOut, true)}
              <small>
                {money(group.moneyIn, true)}
              </small>
            </span>
          </button>);
        })}
      {!results.length && <p className="panel-empty">
        {t("No matching payments.")}
      </p>}
    </>;
  }

  function NamePage({ nameKey, month }) {
    const handleSums = (e) => window.AresiumDisplay.setSums(
      {
        ...sums,
        names: e.target.checked
          ? [...new Set([...sums.names, nameKey])]
          : sums.names.filter((key) => key !== nameKey),
        all: e.target.checked ? sums.all : false
      });
    const handleIndexClick = (i) => group.months[D.months[i].key].count
      && open(
        {
          screen: "name",
          key: nameKey,
          month: D.months[i].key
        });
    const handleOpen = (id) => open({
      screen: "payment",
      id
    });
    const [sums, setSums] = useState(() => window.AresiumDisplay.getSums());
    useEffect(
      () => {
        const fn = () => setSums(window.AresiumDisplay.getSums());
        window.addEventListener("aresium:display", fn);
        return () => window.removeEventListener("aresium:display", fn);
      },
      []);
    const group = D.nameGroups[nameKey];
    if (!group)
      return <p>
        {t("No payments with this name any more.")}
      </p>;
    const amounts = month ? group.months[month] : group;
    return <>
      <h1>
        {group.name}
      </h1>
      <p className="md-sub">
        {group.count}
        {" · "}
        {(month ? D.months.find((m) => m.key === month)?.label : null) || t("All with this name")}
      </p>
      <label className="payback-pick">
        <input
          type="checkbox"
          checked={sums.all || sums.names.includes(nameKey)}
          onChange={handleSums}
        />
        {t("Add up this name everywhere")}
      </label>
      <div className="name-totals">
        <p>
          {t("Expenses")}
          {" "}
          <b>
            {money(amounts.moneyOut, true)}
          </b>
        </p>
        <p>
          {t("Income")}
          {" "}
          <b>
            {money(amounts.moneyIn, true)}
          </b>
        </p>
      </div>
      {!month
        && <>
          <div className="name-chart">
            <AnimatedChart
              partialLast={D.months.at(-1)?.partial}
              animKey={"name-" + nameKey}
              clickable={true}
              xLabels={D.months.map((m) => m.short)}
              xLabel={t("Month")}
              yLabel="EUR"
              theme={document.documentElement.dataset.theme}
              series={[
                {
                  key: "spend",
                  label: t("Expenses"),
                  color: "#FF2D4B",
                  points: D.months.map((m) => group.months[m.key].moneyOut)
                },
                {
                  key: "income",
                  label: t("Income"),
                  color: "#34E27A",
                  points: D.months.map((m) => group.months[m.key].moneyIn)
                }
              ]}
              onIndexClick={handleIndexClick}
            />
          </div>
          <h2 className="panel-subhead">
            {t("By month")}
          </h2>
          {D.months.filter((m) => group.months[m.key].count).map(
            (m) => {
              const handleClick = () => open(
                {
                  screen: "name",
                  key: nameKey,
                  month: m.key
                });
              return (<button
                className="name-result"
                key={m.key}
                onClick={handleClick}
              >
                <span>
                  {m.label}
                </span>
                <span>
                  {money(group.months[m.key].moneyOut, true)}
                  <small>
                    {money(group.months[m.key].moneyIn, true)}
                  </small>
                </span>
              </button>);
            })}
        </>}
      {month
        && <TransactionsPanel
          txns={group.rows.map((id) => D.transactions.find((p) => p.id === id)).filter((p) => p.month === month)}
          onOpen={handleOpen}
        />}
    </>;
  }

  function RenamePage({ ids, mutate }) {
    const saveName = () => mutate(
      "/api/names",
      {
        ids,
        name,
        scope,
        revision: preview?.revision
      });
    const payments = ids.map((id) => D.transactions.find((p) => p.id === id)).filter(Boolean);
    const [preview, setPreview] = useState(null);
    useEffect(
      () => {
        let alive = true;
        api("/api/selection", {
          ids
        }).then((p) => {
          if (alive)
            setPreview(p);
        }).catch(() => { });
        return () => {
          alive = false;
        };
      },
      [JSON.stringify(ids)]);
    const [name, setName] = useState(payments.length === 1 ? payments[0].ownName || payments[0].place : "");
    const [scope, setScope] = useState("payment");
    useDirtyGuard(name !== (payments.length === 1 ? payments[0].ownName || payments[0].place : ""));
    return <>
      <h1>
        {t("Rename")}
      </h1>
      <label className="page-field">
        {t("Name")}
        <input
          maxLength={240}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {payments.map(
        (p) => <p
          key={p.id}
          className="md-sub"
        >
          {t("Bank name")}
          {": "}
          {p.bankName}
        </p>)}
      <label className="payback-pick">
        <input
          type="radio"
          checked={scope === "payment"}
          onChange={() => setScope("payment")}
        />
        {t("Only these payments")}
      </label>
      <label className="payback-pick">
        <input
          type="radio"
          disabled={payments.some((p) => !p.merchant)}
          checked={scope === "shop"}
          onChange={() => setScope("shop")}
        />
        {t("Also the shop’s other payments and future imports")}
        {" "}
        {preview ? " (" + preview.otherCount + ")" : ""}
      </label>
      <button
        className="recat-btn primary"
        onClick={saveName}
      >
        {t("Save")}
      </button>
    </>;
  }
  Object.assign(window.AresiumViews, {
    SearchPage,
    NamePage,
    RenamePage
  });
})();
