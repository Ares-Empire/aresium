(function () {
  const { useState, useEffect } = React;
  const D = window.AresiumData;
  const { t, money, api } = window.AresiumPages;
  const NewCategory = window.AresiumViews.NewCategory;

  function BatchCategoryPage({ ids, mutate }) {
    const handleTargets = (c) => setTargets((old) => mode === "switch" ? [c.name] : [...old, c.name]);
    const saveCategories = () => mutate(
      "/api/transactions",
      {
        ids,
        categories: targets,
        removeCategories: removed,
        mode,
        dropCurrent,
        otherPayments: others,
        revision: preview.revision
      });
    const [otherSide, setOtherSide] = useState(false);
    const [mode, setMode] = useState("switch");
    const [targets, setTargets] = useState([]);
    const [dropCurrent, setDropCurrent] = useState(false);
    const [others, setOthers] = useState(false);
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState("");
    useEffect(
      () => {
        let alive = true;
        setPreview(null);
        api("/api/selection", {
          ids,
          category: targets[0]
        }).then(
          (p) => {
            if (alive) {
              setPreview(p);
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
      [JSON.stringify(ids), targets[0]]);
    const rows = ids.map((id) => D.transactions.find((p) => p.id === id)).filter(Boolean);
    const income = rows[0]?.amount > 0;
    const initialExtras = [...new Set(rows.flatMap((p) => p.tags || []))];
    const removed = mode === "add" ? initialExtras.filter((name) => !targets.includes(name)) : [];
    const choices = (otherSide
      ? D.categories.filter((c) => c.name !== "Uncategorised").map((c) => c.name)
      : income ? D.pick.income : D.pick.spend).map((name) => D.catByName[name]).filter(Boolean);
    return <>
      <h1>
        {t("Category")}
      </h1>
      <p>
        {preview ? preview.count + " · " + money(preview.total, true) : ids.length}
      </p>
      <div className="recat-seg">
        {["switch", "add"].map(
          (m) => {
            const changeMode = () => {
              setMode(m);
              setTargets(m === "add" ? initialExtras : []);
            };
            return (<button
              key={m}
              className={"recat-seg-btn" + (mode === m ? " on" : "")}
              onClick={changeMode}
            >
              {t(m === "switch" ? "Switch" : "Add")}
            </button>);
          })}
      </div>
      <div className="recat-grid">
        {choices.map(
          (c) => {
            const handleTargets = () => setTargets(
              (old) => mode === "switch"
                ? [c.name]
                : old.includes(c.name) ? old.filter((n) => n !== c.name) : [...old, c.name]);
            return (<button
              className={"recat-pick" + (targets.includes(c.name) ? " sel" : "")}
              key={c.name}
              style={{
                color: c.color
              }}
              onClick={handleTargets}
            >
              {c.name}
            </button>);
          })}
      </div>
      <NewCategory
        side={income ? "income" : "spend"}
        mutate={mutate}
        onCreated={handleTargets}
      />
      <button
        className="md-edit"
        onClick={() => setOtherSide((v) => !v)}
      >
        {t("Other category…")}
      </button>
      {mode === "add"
        && <label className="payback-pick">
          <input
            type="checkbox"
            checked={dropCurrent}
            onChange={(e) => setDropCurrent(e.target.checked)}
          />
          {t("Also remove from the current category?")}
        </label>}
      {!!preview?.otherCount
        && <label className="payback-pick">
          <input
            type="checkbox"
            checked={others}
            onChange={(e) => setOthers(e.target.checked)}
          />
          <span>
            {t("Also the shops’ other payments?")}
            <small>
              {preview.otherCount}
              {" · "}
              {preview.shops}
              {" "}
              {t("shops")}
            </small>
          </span>
        </label>}
      {error
        && <p
          className="recat-err"
          role="alert"
        >
          {error}
        </p>}
      <button
        className="recat-btn primary"
        disabled={(!targets.length && (mode !== "add" || !removed.length || dropCurrent)) || !preview}
        onClick={saveCategories}
      >
        {t("Save")}
      </button>
    </>;
  }
  Object.assign(window.AresiumViews, {
    BatchCategoryPage
  });
})();
