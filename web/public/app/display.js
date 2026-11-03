/* Display preferences, like the existing theme: local to this browser, with no accounting. */
(function () {
  const memory = {};
  let sumsMemory = null;
  const get = (key, fallback) => {
    if (Object.hasOwn(memory, key))
      return memory[key];
    try {
      const v = localStorage.getItem("aresium." + key);
      return v === null ? fallback : v === "true";
    } catch (_) {
      return fallback;
    }
  };
  const apply = () => document.documentElement.setAttribute("data-graph-scroll", String(get("graphScroll", true)));
  const set = (key, value) => {
    memory[key] = value;
    try {
      localStorage.setItem("aresium." + key, String(value));
    } catch (_) { }
    apply();
    window.dispatchEvent(new Event("aresium:display"));
  };
  const getSums = () => {
    if (sumsMemory)
      return sumsMemory;
    try {
      return {
        all: false,
        categories: [],
        names: [],
        excluded: [],
        ...JSON.parse(localStorage.getItem("aresium.sums") || "{}")
      };
    } catch (_) {
      return {
        all: false,
        categories: [],
        names: [],
        excluded: []
      };
    }
  };
  const setSums = (value) => {
    sumsMemory = value;
    try {
      localStorage.setItem("aresium.sums", JSON.stringify(value));
    } catch (_) { }
    window.dispatchEvent(new Event("aresium:display"));
  };
  window.AresiumDisplay = {
    get,
    set,
    getSums,
    setSums
  };
  apply();
})();
