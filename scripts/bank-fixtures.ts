// Writes the expected answer next to each bank-file fixture (src/engine/fixtures/banks/*), from the engine's
// readers run in Node. Run it after adding a fixture or changing a reader on purpose, then read the diff of the
// .expected.json files: they are the reference the tests (and the bundled engine) are held to.
//
//   npx tsx scripts/bank-fixtures.ts
import { readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readBankFile } from "../src/engine/readers/read.js";

const folder = new URL("../src/engine/fixtures/banks/", import.meta.url);

export async function bankFixtures(): Promise<string[]> {
  return (await readdir(folder)).filter((name) => !name.endsWith(".json") && !name.startsWith(".")).sort();
}

export async function fixtureAnswer(name: string): Promise<unknown> {
  const bytes = new Uint8Array(await readFile(new URL(name, folder)));
  try {
    return JSON.parse(JSON.stringify(readBankFile(bytes)));
  } catch (error) {
    return { error: { code: (error as { code?: string }).code ?? "unknown", message: (error as Error).message } };
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const name of await bankFixtures()) {
    await writeFile(new URL(`${name}.expected.json`, folder), JSON.stringify(await fixtureAnswer(name), null, 2) + "\n");
    console.log(`wrote ${name}.expected.json`);
  }
}
