(function () {
  const { useEffect } = React;
  const D = window.AresiumData;
  const L = window.AresiumLanguage;
  const t = (s) => L.t(s);
  const money = (n, precise = false) => new Intl.NumberFormat(
    L.locale,
    {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: precise ? 2 : 0,
      minimumFractionDigits: precise ? 2 : 0
    }).format(n);
  const dirtyForms = new Set();
  const discard = () => window.confirm(L.language === "de" ? "Eingegebenen Text verwerfen?" : "Discard entered text?");
  const canLeave = () => !dirtyForms.size || discard();
  const open = (route) => window.dispatchEvent(new CustomEvent("aresium:page", {
    detail: route
  }));
  const shortDay = (day) => new Intl.DateTimeFormat(
    L.locale,
    {
      day: "numeric",
      month: "short",
      ...(day.slice(0, 4) !== D.today?.slice(0, 4) ? {
        year: "numeric"
      } : {}),
      timeZone: "UTC"
    }).format(new Date(day + "T12:00:00Z"));

  function useDirtyGuard(dirty) {
    const token = React.useRef({});
    useEffect(
      () => {
        if (dirty)
          dirtyForms.add(token.current); else
          dirtyForms.delete(token.current);
        return () => dirtyForms.delete(token.current);
      },
      [dirty]);
    useEffect(
      () => {
        const fn = (e) => {
          if (dirtyForms.size) {
            e.preventDefault();
            e.returnValue = "";
          }
        };
        window.addEventListener("beforeunload", fn);
        return () => window.removeEventListener("beforeunload", fn);
      },
      []);
  }

  async function api(path, body) {
    const res = await fetch(
      path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": L.language
        },
        ...(body === undefined ? {} : {
          body: JSON.stringify(body)
        })
      });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || t("Couldn’t save — please try again."));
    return data;
  }
  window.AresiumPages
    = {
    t,
    money,
    shortDay,
    formatDay: shortDay,
    open,
    api,
    discard,
    canLeave,
    useDirtyGuard
  };
  window.AresiumViews = {};
})();
