(function () {
  const { useState, useEffect } = React;
  const D = window.AresiumData;
  const L = window.AresiumLanguage;
  const { t, open, api, canLeave } = window.AresiumPages;
  const { PaybackPage, FixedPage, SearchPage, NamePage, DayPage, QuickSortPage, CashPage, CashEditor,
    CategoriesPage, BatchCategoryPage, RenamePage } = window.AresiumViews;

  function DashboardPageHost() {
    const undoChanges = () => mutate("/api/undo", {
      undo
    });
    const goBack = () => {
      if (!canLeave())
        return;
      setRoute(history.at(-1) || null);
      setHistory((h) => h.slice(0, -1));
    };
    const closePage = () => {
      if (canLeave())
        setRoute(null);
    };
    const openPayment = (id) => open({
      screen: "payment",
      id
    });
    const startQuickSort = () => setRoute({
      screen: "quickSort"
    });
    const closePayment = () => {
      setRoute(history.at(-1) || null);
      setHistory((h) => h.slice(0, -1));
    };
    const undoChangesFromPage = () => mutate("/api/undo", {
      undo
    });
    const [route, setRoute] = useState(null);
    const [history, setHistory] = useState([]);
    const [version, setVersion] = useState(0);
    const [error, setError] = useState("");
    const [undo, setUndo] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(
      () => {
        const fn = (event) => {
          if (!canLeave())
            return;
          setHistory((h) => route ? [...h, route] : []);
          setRoute(event.detail);
          setError("");
        };
        window.addEventListener("aresium:page", fn);
        return () => window.removeEventListener("aresium:page", fn);
      },
      [route]);
    useEffect(
      () => {
        const shells = [...document.querySelectorAll(".app,.mobile-app")];
        if (route && shells.some((shell) => shell.contains(document.activeElement)))
          document.activeElement.blur();
        shells.forEach(
          (shell) => {
            shell.inert = !!route;
            if (route)
              shell.setAttribute("aria-hidden", "true"); else
              shell.removeAttribute("aria-hidden");
          });
        const page = document.querySelector(".dashboard-page");
        if (page) page.scrollTop = 0;
        if (route && page && !page.contains(document.activeElement)
          && !document.querySelector(".tour-bar")?.contains(document.activeElement))
          (page.querySelector("input") || page.querySelector("button"))?.focus();
        return () => shells.forEach(
          (shell) => {
            shell.inert = false;
            shell.removeAttribute("aria-hidden");
          });
      },
      [route]);
    useEffect(
      () => {
        const fn = () => setVersion((v) => v + 1);
        window.addEventListener("aresium:data", fn);
        return () => window.removeEventListener("aresium:data", fn);
      },
      []);
    const mutate = async (path, body) => {
      if (busy)
        return;
      setBusy(true);
      setError("");
      try {
        const result = await api(path, body);
        await D.refresh();
        setUndo(result.undo || null);
        if (["/api/transactions", "/api/names", "/api/paybacks"].includes(path))
          window.dispatchEvent(new Event("aresium:selection-done"));
        if (path === "/api/undo")
          window.dispatchEvent(new Event("aresium:undo"));
        setVersion((v) => v + 1);
        if (["/api/transactions", "/api/names", "/api/paybacks", "/api/paybacks/link", "/api/cash"].includes(path)) {
          setRoute(history.at(-1) || null);
          setHistory((h) => h.slice(0, -1));
        }
        return result;
      }
      catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    useEffect(
      () => {
        if (!route)
          return;
        const key = (event) => {
          if (event.key !== "Escape" || busy)
            return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const nested = document.querySelector(".dashboard-page .recat-overlay");
          if (nested) {
            nested.querySelector("button")?.click();
            return;
          }
          if (canLeave()) {
            setRoute(history.at(-1) || null);
            setHistory((h) => h.slice(0, -1));
          }
        };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
      },
      [route, history, busy]);
    if (!route)
      return undo
        ? <div
          className="import-toast page-notice"
          role="status"
        >
          {error || t("Changes saved.")}
          {" "}
          <button
            className="md-edit"
            disabled={busy}
            onClick={undoChanges}
          >
            {t("Undo")}
          </button>
        </div>
        : null;
    return <div className="page-overlay">
      <div
        className="dashboard-page"
        role="dialog"
        aria-modal="true"
        aria-label={t(
          route.screen === "fixed"
            ? route.side === "income" ? "Regular income" : "Fixed costs"
            : "All with this name")}
        aria-busy={busy}
      >
        <div className="page-nav">
          <button
            className="md-edit"
            onClick={goBack}
          >
            {t("Back")}
          </button>
          <button
            className="md-edit"
            onClick={closePage}
          >
            {t("Close")}
          </button>
        </div>
        {route.screen === "payback"
          && <PaybackPage
            key={JSON.stringify(route)}
            ids={route.ids}
            edit={route.edit}
            mutate={mutate}
          />}
        {route.screen === "fixed"
          && <FixedPage
            side={route.side}
            mutate={mutate}
          />}
        {route.screen === "categoryPayments"
          && <>
            <h1>
              {route.cat}
            </h1>
            <TransactionsPanel
              cat={D.catByName[route.cat]}
              txns={D.categoryMonthTransactions(route.cat, route.month)}
              onOpen={openPayment}
            />
          </>}
        {route.screen === "search" && <SearchPage />}
        {route.screen === "name"
          && <NamePage
            nameKey={route.key}
            month={route.month}
          />}
        {route.screen === "day"
          && <DayPage
            day={route.day}
            initialSide={route.side}
          />}
        {route.screen === "quickSortOffer"
          && <>
            <h1>
              {t("Not sorted")}
            </h1>
            <p>
              {D.raw.quickSort.length}
              {" "}
              {t("shops")}
            </p>
            <button
              className="recat-btn primary"
              onClick={startQuickSort}
            >
              {t("Go through")}
            </button>
            <button
              className="md-edit"
              onClick={() => setRoute(null)}
            >
              {t("Later")}
            </button>
          </>}
        {route.screen === "quickSort" && <QuickSortPage mutate={mutate} />}
        {route.screen === "help"
          && <>
            <h1>
              {t("Help")}
            </h1>
            <div className="help-links">
              <p>
                {L.language === "de"
                  ? "VR Bank: Umsätze als CSV oder CAMT-XML exportieren. PayPal: "
                  + "Aktivitäten → Berichte → Alle Transaktionen, mit Typ und Auswirkung "
                  + "auf Guthaben, als CSV. Andere Banken: CAMT-XML verwenden, falls "
                  + "verfügbar. Weitere Dateiformate unterstützt die iPhone-App."
                  : "VR Bank: export transactions as CSV or CAMT XML. PayPal: Activity → "
                  + "Reports → All transactions, including Type and Balance impact, as CSV. "
                  + "Other banks: use CAMT XML if available. The iPhone app supports "
                  + "additional file formats."}
              </p>
              <p>
                <a href={L.language === "de" ? "/kontakt" : "/contact"}>
                  {t("Contact & support")}
                </a>
              </p>
              <LegalLinks />
              <a
                className="md-edit"
                href="/demo?tour=1"
              >
                {t("Start tour")}
              </a>
            </div>
          </>}
        {route.screen === "cash" && <CashPage />}
        {route.screen === "cashEdit"
          && <CashEditor
            id={route.id}
            mutate={mutate}
          />}
        {route.screen === "categories" && <CategoriesPage mutate={mutate} />}
        {route.screen === "batchCategory"
          && <BatchCategoryPage
            ids={route.ids}
            mutate={mutate}
          />}
        {route.screen === "rename"
          && <RenamePage
            ids={route.ids}
            mutate={mutate}
          />}
        {route.screen === "payment"
          && <TxnDetailModal
            id={route.id}
            onClose={closePayment}
            onChanged={() => D.refresh()}
          />}
        {error
          && <p
            className="recat-err"
            role="alert"
          >
            {error}
            {" "}
            {window.AresiumDemo && <a href="/login/email">
              {t("Log in")}
            </a>}
          </p>}
        {undo
          && <div
            className="page-undo"
            role="status"
          >
            {t("Changes saved.")}
            {" "}
            <button
              className="md-edit"
              disabled={busy}
              onClick={undoChangesFromPage}
            >
              {t("Undo")}
            </button>
          </div>}
      </div>
    </div>;
  }

  function DashboardTools() {
    const openQuickSort = () => open({
      screen: "quickSort"
    });
    const openFixedCosts = () => open({
      screen: "fixed",
      side: "expenses"
    });
    return <>
      <button
        className="md-edit"
        onClick={() => open({
          screen: "categories"
        })}
        aria-label={t("Categories")}
      >
        {"⚙"}
      </button>
      {!!D.raw.quickSort?.length
        && <button
          className="md-edit page-shortcut"
          onClick={openQuickSort}
        >
          {t("Not sorted")}
        </button>}
      <button
        className="md-edit"
        onClick={() => open({
          screen: "search"
        })}
        aria-label={t("Search")}
      >
        {"⌕"}
      </button>
      <button
        className="md-edit page-shortcut"
        onClick={openFixedCosts}
      >
        {t("Fixed costs")}
      </button>
      <button
        className="md-edit"
        onClick={() => L.set(L.language === "de" ? "en" : "de")}
      >
        {L.language === "de" ? "EN" : "DE"}
      </button>
    </>;
  }
  Object.assign(window.AresiumViews, {
    DashboardPageHost,
    DashboardTools
  });
  Object.assign(window, {
    DashboardPageHost,
    DashboardTools
  });
})();
