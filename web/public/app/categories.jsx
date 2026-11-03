(function () {
  const { useState } = React;
  const D = window.AresiumData;
  const { t, open, api, discard, useDirtyGuard } = window.AresiumPages;

  function NewCategory({ side, mutate, onCreated }) {
    const createOnEnter = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.querySelector("[data-create]").click();
      }
    };
    const cancelNewCategory = () => {
      if (!name.trim() || discard())
        setShow(false);
    };
    const createCategory = async () => {
      const result = await mutate(
        "/api/categories",
        {
          action: "create",
          name,
          side
        });
      if (result?.category) {
        onCreated?.(result.category);
        setShow(false);
        setName("");
      }
    };
    const [show, setShow] = useState(false);
    const [name, setName] = useState("");
    useDirtyGuard(show && !!name.trim());
    if (!show)
      return <button
        className="recat-pick"
        onClick={() => setShow(true)}
      >
        {"+ "}
        {t("New category")}
      </button>;
    return <div
      className="new-category"
      onKeyDown={createOnEnter}
    >
      <label className="page-field">
        {t("New category")}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder={t("Name")}
        />
      </label>
      <button
        type="button"
        className="md-edit"
        onClick={cancelNewCategory}
      >
        {t("Cancel")}
      </button>
      <button
        type="button"
        data-create
        className="recat-btn primary"
        disabled={!name.trim()}
        onClick={createCategory}
      >
        {t("Create")}
      </button>
    </div>;
  }

  function CategoriesPage({ mutate }) {
    const toggleGraph = (e) => window.AresiumDisplay.set("graph", e.target.checked);
    const toggleGraphScroll = (e) => window.AresiumDisplay.set("graphScroll", e.target.checked);
    const toggleAllSums = (e) => {
      const value = e.target.checked
        ? {
          ...sums,
          all: true,
          excluded: []
        }
        : {
          all: false,
          categories: [],
          names: [],
          excluded: []
        };
      setSums(value);
      window.AresiumDisplay.setSums(value);
    };
    const toggleOwnNames = (e) => mutate("/api/names/display", {
      enabled: e.target.checked
    });
    const renameCategory = async (e) => {
      e.preventDefault();
      if (await mutate(
        "/api/categories",
        {
          action: "rename",
          id: editing.id,
          name
        }))
        setEditing(null);
    };
    const cancelRename = () => {
      if (name === editing.name || discard())
        setEditing(null);
    };
    const restoreOriginalName = async () => {
      if (await mutate(
        "/api/categories",
        {
          action: "rename",
          id: editing.id,
          original: true
        }))
        setEditing(null);
    };
    const deleteCategory = async () => {
      if (await mutate(
        "/api/categories",
        {
          action: "delete",
          id: deleting.id
        }))
        setDeleting(null);
    };
    const [sums, setSums] = useState(() => window.AresiumDisplay.getSums());
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState("");
    const [deleting, setDeleting] = useState(null);
    const [newSide, setNewSide] = useState("spend");
    useDirtyGuard(!!editing && name !== editing.name);
    return <>
      <h1>
        {t("Categories")}
      </h1>
      <button
        className="md-edit"
        onClick={() => open({
          screen: "help"
        })}
      >
        {t("Help")}
      </button>
      <div className="selection-tools">
        {[
          ["Fixed costs", "fixed", "expenses"],
          ["Regular income", "fixed", "income"],
          ["Not sorted", "quickSort"],
          ["Cash", "cash"]
        ].map(
          ([label, screen, side]) => {
            const openPage = () => open({
              screen,
              side
            });
            return (<button
              className="md-edit"
              key={label}
              onClick={openPage}
            >
              {t(label)}
            </button>);
          })}
      </div>
      <label className="payback-pick">
        <input
          type="checkbox"
          defaultChecked={window.AresiumDisplay.get("graph", true)}
          onChange={toggleGraph}
        />
        {t("Graph")}
      </label>
      <label className="payback-pick">
        <input
          type="checkbox"
          defaultChecked={window.AresiumDisplay.get("graphScroll", true)}
          onChange={toggleGraphScroll}
        />
        {t("Graph scrolls with the page")}
      </label>
      <label className="payback-pick">
        <input
          type="checkbox"
          checked={sums.all}
          onChange={toggleAllSums}
        />
        {t("Add up all names")}
      </label>
      <a
        className="md-edit"
        href="/demo?tour=1"
      >
        {t("Start tour")}
      </a>
      <label className="payback-pick">
        <input
          type="checkbox"
          checked={D.ownNames !== false}
          onChange={toggleOwnNames}
        />
        {t("Own names")}
      </label>
      <label className="page-field">
        {t("Home side")}
        <select
          value={newSide}
          onChange={(e) => setNewSide(e.target.value)}
        >
          <option value="spend">
            {t("Expenses")}
          </option>
          <option value="income">
            {t("Income")}
          </option>
        </select>
      </label>
      <NewCategory
        side={newSide}
        mutate={mutate}
      />
      {(D.raw.categoryOptions || []).map(
        (c) => {
          const handleClick = () => mutate(
            "/api/categories",
            {
              action: "restore",
              id: c.id
            });
          const handleEditing = () => {
            setEditing(c);
            setName(c.name);
          };
          const handleChange = (e) => mutate(
            "/api/categories",
            {
              action: "side",
              id: c.id,
              side: e.target.value
            });
          const handleChange2 = (e) => mutate(
            "/api/categories",
            {
              action: "side",
              id: c.id,
              otherSide: e.target.checked
            });
          return (<section
            className="category-setting"
            key={c.id}
          >
            <div className="name-result">
              <span>
                <b>
                  {c.name}
                </b>
                <small>
                  {c.paymentCount}
                  {" · "}
                  {t(c.kind === "transfer" ? "Transfers" : c.kind === "income" ? "Income" : "Expenses")}
                  {c.removed ? " · " + t("Removed categories") : ""}
                </small>
              </span>
              <span>
                {c.removed
                  ? <button
                    className="md-edit"
                    onClick={handleClick}
                  >
                    {t("Restore")}
                  </button>
                  : !c.protected
                  && <>
                    <button
                      className="md-edit"
                      onClick={handleEditing}
                    >
                      {t("Rename")}
                    </button>
                    <button
                      className="md-edit"
                      onClick={() => setDeleting(c)}
                    >
                      {t(c.default ? "Remove" : "Delete")}
                    </button>
                  </>}
              </span>
            </div>
            {!c.removed && !c.protected && c.kind !== "transfer"
              && <>
                <label className="page-field">
                  {t("Home side")}
                  <select
                    aria-label={t("Home side") + " " + c.name}
                    value={c.kind === "income" ? "income" : "spend"}
                    onChange={handleChange}
                  >
                    <option value="spend">
                      {t("Expenses")}
                    </option>
                    <option value="income">
                      {t("Income")}
                    </option>
                  </select>
                </label>
                <label className="payback-pick">
                  <input
                    type="checkbox"
                    checked={c.otherSide}
                    onChange={handleChange2}
                  />
                  {t("Also offered on the other side")}
                </label>
              </>}
          </section>);
        })}
      {editing
        && <div className="recat-overlay">
          <form
            className="recat-card"
            role="dialog"
            aria-label={t("Rename category")}
            onSubmit={renameCategory}
          >
            <h2>
              {t("Rename category")}
            </h2>
            <label className="page-field">
              {t("Name")}
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="md-edit"
              onClick={cancelRename}
            >
              {t("Cancel")}
            </button>
            {editing.originalName && editing.originalName !== editing.name
              && <button
                type="button"
                className="md-edit"
                onClick={restoreOriginalName}
              >
                {t("Use the original name")}
              </button>}
            <button
              className="recat-btn primary"
              disabled={!name.trim() || name === editing.name}
            >
              {t("Rename")}
            </button>
          </form>
        </div>}
      {deleting
        && <div className="recat-overlay">
          <div
            className="recat-card"
            role="alertdialog"
            aria-label={t(deleting.default ? "Remove category?" : "Delete category?")}
          >
            <h2>
              {deleting.name}
            </h2>
            <p>
              {t("Its payments are sorted again. Those Aresium cannot sort go to Not sorted.")}
            </p>
            {deleting.default && <p>
              {t("It can be restored any time.")}
            </p>}
            <button
              className="md-edit"
              onClick={() => setDeleting(null)}
            >
              {t("Cancel")}
            </button>
            <button
              className="recat-btn danger"
              onClick={deleteCategory}
            >
              {t(deleting.default ? "Remove" : "Delete")}
            </button>
          </div>
        </div>}
    </>;
  }
  Object.assign(window.AresiumViews, {
    NewCategory,
    CategoriesPage
  });
})();
