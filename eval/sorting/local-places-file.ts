import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { LocalPlacesData, LocalPlacesInput } from "../../src/engine/sorting/local-places.js";

/** Reads the local places JSON or packed list, compressed or not. */
export async function readLocalPlaces(path: string): Promise<LocalPlacesInput> {
  const bytes = await readFile(resolve(path));
  const raw = path.endsWith(".gz") ? gunzipSync(bytes) : bytes;
  return /\.bin(?:\.gz)?$/.test(path) ? raw : JSON.parse(raw.toString("utf8")) as LocalPlacesData;
}
