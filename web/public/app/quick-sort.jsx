(function () {
  const { useState, useEffect } = React;
  const D = window.AresiumData;
  const { t, money, shortDay, api } = window.AresiumPages;
  const NewCategory = window.AresiumViews.NewCategory;

  function QuickSortPage({ mutate }) {
    const sortIntoNewCategory = () => mutate(
      "/api/quick-sort",
      {
        key: group.key,
        ids: group.ids,
        category: newCategory.name
      });
    const [newCategory, setNewCategory] = useState(null);
    const [skipped, setSkipped] = useState([]);
    const [finished, setFinished] = useState([]);
    const initial = React.useRef(D.raw.quickSort?.map((g) => g.key) || []);
    useEffect(
      () => {
        const fn = () => setFinished((old) => old.slice(0, -1));
        window.addEventListener("aresium:undo", fn);
        return () => window.removeEventListener("aresium:undo", fn);
      },
      []);
    const groups = (D.raw.quickSort || []).filter((g) => !skipped.includes(g.key));
    const group = groups[0];
    return <>
      <h1>
        {t("Go through not sorted")}
      </h1>
      <p className="md-sub">
        {finished.length + skipped.length + (group ? 1 : 0)}
        {" / "}
        {initial.current.length}
      </p>
      {group
        ? <>
          <h2>
            {group.name}
          </h2>
          <p>
            {group.count}
            {" "}
            {t("Payments")}
            {" · "}
            {money(group.total, true)}
            {" · "}
            {t(group.side === "income" ? "Income" : "Expenses")}
          </p>
          <p className="md-sub">
            {shortDay(group.first)}
            {" – "}
            {shortDay(group.last)}
          </p>
          {group.examples.map(
            (text) => <p
              key={text}
              className="recat-hint"
            >
              {text}
            </p>)}
          <div className="recat-grid">
            {D.pick[group.side].map(
              (name) => {
                const sortName = async () => {
                  const ok = await mutate(
                    "/api/quick-sort",
                    {
                      key: group.key,
                      ids: group.ids,
                      category: name
                    });
                  if (ok)
                    setFinished((old) => [...old, group.key]);
                };
                return (<button
                  className="recat-pick"
                  key={name}
                  style={{
                    color: D.catByName[name]?.color
                  }}
                  onClick={sortName}
                >
                  {name}
                </button>);
              })}
          </div>
          <NewCategory
            side={group.side}
            mutate={mutate}
            onCreated={(c) => setNewCategory(c)}
          />
          {!!newCategory
            && <button
              className="recat-btn primary"
              onClick={sortIntoNewCategory}
            >
              {t("Save")}
              {" · "}
              {newCategory.name}
            </button>}
          <button
            className="md-edit"
            onClick={() => setSkipped((old) => [...old, group.key])}
          >
            {t("Skip")}
          </button>
        </>
        : <p>
          {finished.length}
          {" "}
          {t("names sorted")}
          {" · "}
          {skipped.length}
          {" "}
          {t("skipped")}
        </p>}
    </>;
  }
  Object.assign(window.AresiumViews, {
    QuickSortPage
  });
})();
