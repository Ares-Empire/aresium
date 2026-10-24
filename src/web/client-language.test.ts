import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";
import { buildDashboard } from "../data/dashboard.js";

test("website initial load, refresh and import explicitly request English", async () => {
  const dashboard = buildDashboard({ months: [], categories: [], transactions: [], balanceByDay: {}, openingBalance: 0, databaseCategoryNames: [] });
  const requests: { url: string; headers: Record<string, string> }[] = [];
  class XHR {
    url = "";
    headers: Record<string, string> = {};
    status = 200;
    responseText = JSON.stringify(dashboard);
    open(_method: string, url: string) { this.url = url; }
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    send() { requests.push({ url: this.url, headers: this.headers }); }
  }
  const window = {} as { AresiumData: { refresh(): Promise<void> }; AresiumUpload: { send(files: unknown[]): Promise<void> } };
  const context = createContext({
    window, location: { protocol: "https:" }, navigator: { language: "de-DE" }, XMLHttpRequest: XHR,
    fetch: async (url: string, init: { headers: Record<string, string> }) => {
      requests.push({ url, headers: init.headers });
      return { ok: true, json: async () => url === "/api/data" ? dashboard : { results: [] } };
    },
  });
  for (const script of ["data.js", "upload.js"]) {
    runInContext(await readFile(new URL(`../../web/public/app/${script}`, import.meta.url), "utf8"), context);
  }
  await window.AresiumData.refresh();
  await window.AresiumUpload.send([{ name: "sample.csv", size: 10, text: async () => "sample" }]);
  assert.deepEqual(requests.map((r) => r.url), ["/api/data", "/api/data", "/api/import"]);
  for (const request of requests) assert.equal(request.headers["Accept-Language"], "en");
});
