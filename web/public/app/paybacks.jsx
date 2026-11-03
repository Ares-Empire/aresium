(function () {
  const { useState, useEffect } = React;
  const D = window.AresiumData;
  const { t, money, shortDay, open, api } = window.AresiumPages;

  function PaybackPage({ ids, mutate, edit }) {
    const saveLinkAmount = () => mutate(
      "/api/paybacks/link",
      {
        from: edit.from,
        to: edit.to,
        amount: Number(amount.replace(",", "."))
      });
    const removeLink = () => mutate(
      "/api/paybacks/link",
      {
        from: edit.from,
        to: edit.to,
        amount: 0
      });
    const linkPayments = () => mutate(
      "/api/paybacks",
      {
        ids,
        others: picked,
        revision: preview.revision,
        ...(amount && ids.length === 1 && picked.length === 1
          ? {
            amount: Number(amount.replace(",", "."))
          }
          : {})
      });
    const [choice, setChoice] = useState(null);
    const [picked, setPicked] = useState([]);
    const [query, setQuery] = useState("");
    const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState("");
    useEffect(
      () => {
        let alive = true;
        api("/api/paybacks/preview", {
          ids
        }).then((d) => {
          if (alive)
            setChoice(d);
        }).catch((e) => {
          if (alive)
            setError(e.message);
        });
        return () => {
          alive = false;
        };
      },
      [JSON.stringify(ids)]);
    useEffect(
      () => {
        setPreview(null);
        if (!picked.length || !choice)
          return;
        let alive = true;
        api(
          "/api/paybacks/preview",
          {
            ids,
            others: picked,
            ...(amount && ids.length === 1 && picked.length === 1
              ? {
                amount: Number(amount.replace(",", "."))
              }
              : {})
          }).then(
            (d) => {
              if (alive) {
                setPreview(d);
                setError("");
              }
            }).catch((e) => {
              if (alive)
                setError(e.message);
            });
        return () => {
          alive = false;
        };
      },
      [JSON.stringify(picked), amount, choice]);
    const matches = (p) => window.AresiumSearch.matches(
      query,
      [p.place, p.bankName, ...(D.nameGroups[p.nameKey]?.names || [])].filter(Boolean));
    const suggested = choice?.suggestions || [];
    const rows = choice
      ? query
        ? choice.candidates.filter(matches)
        : suggested.map((s) => choice.candidates.find((p) => p.id === s.id)).filter(Boolean)
      : [];
    return <>
      <h1>
        {t("Money paid back")}
      </h1>
      {edit
        ? <>
          <p>
            {D.transactions.find((p) => p.id === edit.from)?.place}
            {" → "}
            {D.transactions.find((p) => p.id === edit.to)?.place}
          </p>
          <label className="page-field">
            {t("Amount")}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button
            className="recat-btn primary"
            onClick={saveLinkAmount}
          >
            {t("Save")}
          </button>
          <button
            className="md-edit"
            onClick={removeLink}
          >
            {t("Remove link")}
          </button>
        </>
        : <>
          {choice
            && <>
              <p>
                {choice.group.length}
                {" "}
                {t(choice.group[0].amount < 0 ? "expenses" : "payments in")}
                {" · "}
                {money(choice.rest, true)}
              </p>
              {!!choice.skipped
                && <p className="md-sub">
                  {choice.skipped}
                  {" "}
                  {t("payments left out")}
                </p>}
              <p>
                {t(choice.group[0].amount < 0 ? "Paid back to you" : "Pays back an expense")}
              </p>
              <label className="page-field">
                {t("Search all payments")}
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <h2 className="panel-subhead">
                {t(query ? "Search" : "Suggestions")}
              </h2>
              {rows.map(
                (p) => {
                  const togglePayment = () => {
                    const next = picked.includes(p.id) ? picked.filter((id) => id !== p.id) : [...picked, p.id];
                    setPicked(next);
                    setAmount(
                      ids.length === 1 && next.length === 1
                        ? String(suggested.find((s) => s.id === next[0])?.amount || "")
                        : "");
                  };
                  return (<label
                    className="payback-pick"
                    key={p.id}
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(p.id)}
                      onChange={togglePayment}
                    />
                    <span>
                      <b>
                        {p.place}
                      </b>
                      <small>
                        {shortDay(p.date)}
                        {suggested.find((s) => s.id === p.id)?.fit
                          ? " · " + t(suggested.find((s) => s.id === p.id).fit)
                          : ""}
                      </small>
                    </span>
                    <span>
                      <span className="payback-amount">{money(p.counted ?? p.amount, true)}</span>
                    </span>
                  </label>);
                })}
              {!rows.length
                && <p className="panel-empty">
                  {t("No matching payments.")}
                </p>}
              {ids.length === 1 && picked.length === 1
                && <label className="page-field">
                  {t("Amount")}
                  <input
                    inputMode="decimal"
                    placeholder={String(preview?.plan?.linked || "")}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>}
              {preview?.plan
                && <section
                  className="payback-summary"
                  aria-live="polite"
                >
                  {preview.plan.expenses.map(
                    (p) => <p key={p.id}>
                      {D.transactions.find((row) => row.id === p.id)?.place}
                      {": "}
                      <span className="payback-amount">{money(p.amount, true)}</span>
                      {" "}
                      {t("paid back")}
                      {" · "}
                      {money(p.rest, true)}
                      {" "}
                      {t("still open")}
                    </p>)}
                  <p>
                    {money(preview.plan.staysIncome, true)}
                    {" "}
                    {t("stays income")}
                  </p>
                </section>}
              <button
                className="recat-btn primary"
                disabled={!preview?.plan?.links.length}
                onClick={linkPayments}
              >
                {t("Link")}
              </button>
            </>}
        </>}
      {error
        && <p
          role="alert"
          className="recat-err"
        >
          {error}
          {" "}
          {window.AresiumDemo && <a href="/login/email">
            {t("Log in")}
          </a>}
        </p>}
    </>;
  }

  function PaybackDetail({ id }) {
    const openPayment = () => open({
      screen: "payback",
      ids: [id]
    });
    const p = D.transactions.find((p) => p.id === id);
    if (!p)
      return null;
    const links = p.amount < 0 ? p.paidBackBy : p.paysBack;
    return <section className="payback-detail">
      <p>
        {t("Original amount")}
        {": "}
        <span className="payback-amount">{money(p.amount, true)}</span>
        {" · "}
        {t(p.amount < 0 ? "Your share" : "stays income")}
        {": "}
        <span className="payback-amount">{money(p.counted ?? p.amount, true)}</span>
      </p>
      {(links || []).map(
        (link) => {
          const openPayment = () => open({
            screen: "payment",
            id: link.payment
          });
          const editLink = () => open(
            {
              screen: "payback",
              ids: [id],
              edit: {
                from: p.amount > 0 ? id : link.payment,
                to: p.amount < 0 ? id : link.payment,
                amount: link.amount
              }
            });
          return (<div
            className="fixed-row"
            key={link.payment}
          >
            <button
              className="md-edit"
              onClick={openPayment}
            >
              {D.transactions.find((p) => p.id === link.payment)?.place}
              {" · "}
              {money(link.amount, true)}
            </button>
            <button
              className="md-edit"
              onClick={editLink}
            >
              {t("Change amount")}
            </button>
          </div>);
        })}
      {p.paybackEligible && (p.counted ?? p.amount) !== 0
        && <button
          className="md-edit"
          onClick={openPayment}
        >
          {t(p.amount < 0 ? "Paid back to you" : "Pays back an expense")}
        </button>}
    </section>;
  }
  Object.assign(window.AresiumViews, {
    PaybackPage,
    PaybackDetail
  });
  Object.assign(window, {
    PaybackDetail
  });
})();
