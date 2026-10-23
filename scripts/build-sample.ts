import { writeFile } from "node:fs/promises";
import { buildDashboard } from "../src/data/dashboard.js";
import { buildSampleSource } from "../src/data/sample-source.js";

const json = JSON.stringify(buildDashboard(buildSampleSource()));
for (const [name, contents] of [
  ["dashboard.sample.json", json + "\n"],
  ["dashboard.sample.js", "window.AresiumSample = " + json + ";\n"],
]) {
  await writeFile(new URL(`../web/public/app/${name}`, import.meta.url), contents);
  console.log(`Wrote web/public/app/${name} (${Buffer.byteLength(contents)} bytes)`);
}
