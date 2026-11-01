// Build-time only: pack the existing JSON without changing any matching evidence.
import type { LocalPlacesData } from "../src/engine/sorting/local-places.js";
import { PackedLocalPlaces, PLACES_HEADER_BYTES, PLACES_MAGIC, PLACES_VERSION, NO_LOCAL_CATEGORY, placesChecksum } from "../src/engine/sorting/local-places-packed.js";

export function packLocalPlaces(data: LocalPlacesData): Uint8Array {
  if (data.version !== 1) throw new Error("Cannot pack unsupported local places JSON version");
  const rows = data.rows.map((row) => ({ row, name: Buffer.from(row[0], "utf8") })).sort((a, b) => Buffer.compare(a.name, b.name));
  if (data.categories.length >= NO_LOCAL_CATEGORY) throw new Error("Too many local place categories");
  const header = new Uint32Array(PLACES_HEADER_BYTES / 4);
  header.set([PLACES_MAGIC, PLACES_VERSION, 0x01020304, 0, rows.length, data.towns.length, data.categories.length,
    rows.reduce((n, { row }) => n + row[2].length / 2, 0), PLACES_HEADER_BYTES]);
  const sections: Uint8Array[] = [];
  let next = PLACES_HEADER_BYTES;
  const append = (word: number, value: Uint8Array) => {
    header[word] = next;
    sections.push(value);
    next += Math.ceil(value.length / 4) * 4;
  };
  const u32 = (word: number, values: readonly number[]) => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, i) => bytes.writeUInt32LE(value, i * 4)); append(word, bytes);
  };
  const u16 = (word: number, values: readonly number[]) => {
    const bytes = Buffer.alloc(values.length * 2);
    values.forEach((value, i) => bytes.writeUInt16LE(value, i * 2)); append(word, bytes);
  };
  const strings = (word: number, values: readonly Uint8Array[]) => {
    let offset = 0;
    const offsets = values.map((value) => { const start = offset; offset += value.length; return start; });
    u32(word, [...offsets, offset]);
    append(word + 1, Buffer.concat(values));
  };
  strings(9, rows.map(({ name }) => name));
  u16(11, rows.map(({ row }) => row[1] === -1 ? NO_LOCAL_CATEGORY : row[1]));
  let count = 0;
  const matchOffsets = [0], towns: number[] = [], categories: number[] = [];
  for (const { row } of rows) {
    if (row[2].length % 2) throw new Error("Incomplete local place town pair");
    const pairs: [number, number][] = [];
    for (let i = 0; i < row[2].length; i += 2) pairs.push([row[2][i], row[2][i + 1]]);
    pairs.sort(([a, ac], [b, bc]) => a - b || ac - bc);
    for (const [town, category] of pairs) { towns.push(town); categories.push(category); count++; }
    matchOffsets.push(count);
  }
  u32(12, matchOffsets); u32(13, towns); u16(14, categories);
  strings(15, data.towns.map((town) => Buffer.from(town, "utf8")));
  strings(17, data.categories.map((category) => Buffer.from(category, "utf8")));
  strings(19, [data.dataDate, data.attribution, data.source].map((text) => Buffer.from(text, "utf8")));
  header[3] = header[21] = next;
  const bytes = new Uint8Array(next);
  const view = new DataView(bytes.buffer);
  header.forEach((value, i) => view.setUint32(i * 4, value, true));
  next = PLACES_HEADER_BYTES;
  for (const section of sections) { bytes.set(section, next); next += Math.ceil(section.length / 4) * 4; }
  view.setUint32(88, placesChecksum(bytes), true);
  new PackedLocalPlaces(bytes); // Refuse invalid codes, strings or duplicate names before writing an asset.
  return bytes;
}
