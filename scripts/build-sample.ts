import { writeFile } from "node:fs/promises";
import { buildWebSample } from "../src/data/web-sample.js";

const json = JSON.stringify(buildWebSample());
for (const [name, contents] of [
  ["dashboard.sample.json", json + "\n"],
  ["dashboard.sample.js", "window.AresiumSample = " + json + ";\n"],
]) {
  await writeFile(new URL(`../web/public/app/${name}`, import.meta.url), contents);
  console.log(`Wrote web/public/app/${name} (${Buffer.byteLength(contents)} bytes)`);
}
