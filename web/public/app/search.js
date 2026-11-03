/* Display-only ranking over server-built name groups. No money is calculated here. */
(function () {
  const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss").replace(
    /[^\p{L}\p{N}]+/gu, " ").trim();
  function oneEdit(a, b) {
    a = [...a];
    b = [...b];
    if (Math.abs(a.length - b.length) > 1)
      return false;
    let x = 0;
    let y = 0;
    let edits = 0;
    while (x < a.length && y < b.length) {
      if (a[x] === b[y]) {
        x++;
        y++;
        continue;
      }
      if (++edits > 1)
        return false;
      if (a.length >= b.length)
        x++;
      if (b.length >= a.length)
        y++;
    }
    return edits + a.length - x + b.length - y <= 1;
  }
  function search(query, groups) {
    const q = fold(query);
    if (!q)
      return [];
    const words = q.split(" ");
    const hits = [];
    for (const group of Object.values(groups)) {
      let best = null;
      for (const original of [group.name, ...group.names]) {
        const name = fold(original);
        const parts = name.split(" ");
        const tier = name === q
          ? 1
          : name.startsWith(q)
            ? 2
            : words.every((w) => parts.some((p) => p.startsWith(w)))
              ? 3
              : words.every((w) => name.includes(w))
                ? 4
                : words.every((w) => name.includes(w) || ([...w].length >= 4 && parts.some((p) => oneEdit(w, p))))
                  ? 5
                  : 0;
        if (!tier)
          continue;
        const shown = original === group.name;
        if (!best || tier < best.tier || (tier === best.tier && shown && !best.shown))
          best = {
            tier,
            shown,
            matchedName: shown ? null : original
          };
      }
      if (best)
        hits.push({
          ...group,
          ...best
        });
    }
    return hits.sort(
      (a, b) => a.tier - b.tier || Number(b.shown) - Number(a.shown) || b.count - a.count
        || b.newestDate.localeCompare(a.newestDate)
        || a.key.localeCompare(b.key)).slice(0, 50);
  }
  const matches = (query, names) => {
    const q = fold(query);
    if (!q)
      return false;
    return names.some(
      (name) => {
        const n = fold(name);
        const parts = n.split(" ");
        return q.split(" ").every((w) => n.includes(w) || ([...w].length >= 4 && parts.some((p) => oneEdit(w, p))));
      });
  };
  window.AresiumSearch = {
    search,
    matches,
    fold,
    oneEdit
  };
})();
