import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { LocalPlacesData } from "../../src/engine/sorting/local-places.js";

/** Reads the local places list, compressed (`.json.gz`, as the repo keeps it) or not. */
export async function readLocalPlaces(path: string): Promise<LocalPlacesData> {
  const bytes = await readFile(resolve(path));
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8")) as LocalPlacesData;
}
