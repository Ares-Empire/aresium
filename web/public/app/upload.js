/* Aresium — upload helper (window.AresiumUpload).

   Shared by the desktop (app.jsx) and phone (mobile.jsx) UIs so the "send my bank /
   PayPal exports" flow lives in one place. Reads the picked files as text in the
   browser and POSTs them as plain JSON to /api/import (the files are small CSV/XML, so
   no multipart is needed). The server parses, ingests idempotently, and categorises;
   the React side then calls window.AresiumData.refresh() and morphs to the new totals. */
(function () {
  "use strict";

  const MAX_BYTES = 20 * 1024 * 1024;   // client-side guard; server enforces its own cap

  // fileList: a FileList or File[]. Returns the server summary { results:[{name,added,
  // total,account,skipped,error?}] }. Throws on no usable files / oversize / network.
  async function send(fileList) {
    const picked = Array.prototype.slice.call(fileList || []);
    const files = [];
    for (const f of picked) {
      if (!/\.(csv|xml)$/i.test(f.name)) continue;       // skip anything that isn't an export
      if (f.size > MAX_BYTES) throw new Error(f.name + " is too large (max 20 MB)");
      files.push({ name: f.name, content: await f.text() });
    }
    if (files.length === 0) throw new Error("Pick a VR Bank or PayPal .csv (or CAMT .xml) export.");

    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) {
      let msg = "Import failed (" + res.status + ")";
      try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // Roll the per-file results into one short human line for a toast.
  function summarize(data) {
    const r = (data && data.results) || [];
    const added = r.reduce((s, x) => s + (x.added || 0), 0);
    const errs = r.filter((x) => x.error);
    if (errs.length) return added + " added · " + errs.length + " file(s) failed";
    const skipped = r.filter((x) => x.skipped).length;
    return added + " new transaction" + (added === 1 ? "" : "s") + " imported" +
      (skipped ? " · " + skipped + " skipped" : "");
  }

  window.AresiumUpload = { send, summarize };
})();
