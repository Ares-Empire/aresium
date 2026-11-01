// One immutable little-endian block. No TextEncoder/TextDecoder: JavaScriptCore does not provide them.
export const PLACES_MAGIC = 0x504c5241; // ASCII ARLP
export const PLACES_VERSION = 1;
export const PLACES_HEADER_BYTES = 128;
export const NO_LOCAL_CATEGORY = 0xffff;
const fail = (reason: string): never => { throw new Error(`Invalid packed local places: ${reason}`); };
const aligned = (size: number) => Math.ceil(size / 4) * 4;

/** FNV-1a of the complete file, with the checksum word (header word 22) treated as zero. */
export function placesChecksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ (i >= 88 && i < 92 ? 0 : bytes[i]), 0x01000193);
  return hash >>> 0;
}

export function localUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | cp >> 6, 0x80 | cp & 63);
    else if (cp < 0x10000) bytes.push(0xe0 | cp >> 12, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
    else bytes.push(0xf0 | cp >> 18, 0x80 | cp >> 12 & 63, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
  }
  return new Uint8Array(bytes);
}

// Call only on validated string boundaries. At lookup time only a matched town/category is decoded.
function textAt(bytes: Uint8Array, offsets: Uint32Array, row: number): string {
  let text = "";
  for (let i = offsets[row]; i < offsets[row + 1];) {
    const b = bytes[i++];
    let cp = b;
    if (b >= 0xc0) {
      const need = b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3;
      cp = b & (need === 1 ? 31 : need === 2 ? 15 : 7);
      for (let n = 0; n < need; n++) cp = cp << 6 | bytes[i++] & 63;
    }
    text += String.fromCodePoint(cp);
  }
  return text;
}
function compare(bytes: Uint8Array, start: number, end: number, other: Uint8Array, from = 0, to = other.length): number {
  while (start < end && from < to) {
    const difference = bytes[start++] - other[from++];
    if (difference) return difference;
  }
  return (end - start) - (to - from);
}
function checkStrings(bytes: Uint8Array, offsets: Uint32Array, sorted: boolean): void {
  if (offsets[0] !== 0 || offsets[offsets.length - 1] !== bytes.length) fail("string offsets");
  for (let row = 0; row + 1 < offsets.length; row++) {
    const start = offsets[row], end = offsets[row + 1];
    if (end < start || end > bytes.length || sorted && end === start) fail("string range");
    if (sorted && row && compare(bytes, offsets[row - 1], start, bytes, start, end) >= 0) fail("name ordering");
    for (let i = start; i < end;) {
      const b = bytes[i++];
      if (b < 0x80) continue;
      const need = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0;
      if (!need || i + need > end) fail("UTF-8");
      let cp = b & (need === 1 ? 31 : need === 2 ? 15 : 7);
      for (let n = 0; n < need; n++) {
        const next = bytes[i++];
        if ((next & 0xc0) !== 0x80) fail("UTF-8");
        cp = cp << 6 | next & 63;
      }
      if (cp < (need === 1 ? 0x80 : need === 2 ? 0x800 : 0x10000) || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff) fail("UTF-8");
    }
  }
}

/** Views only: no per-name objects, strings, or copies of the supplied bytes. Treat the buffer as immutable. */
export class PackedLocalPlaces {
  readonly bytes: Uint8Array;
  readonly header: Uint32Array;
  readonly nameOffsets: Uint32Array;
  readonly names: Uint8Array;
  readonly nationalCategories: Uint16Array;
  readonly matchOffsets: Uint32Array;
  readonly matchTowns: Uint32Array;
  readonly matchCategories: Uint16Array;
  readonly townOffsets: Uint32Array;
  readonly towns: Uint8Array;
  readonly categoryOffsets: Uint32Array;
  readonly categories: Uint8Array;
  readonly metadataOffsets: Uint32Array;
  readonly metadata: Uint8Array;

  constructor(input: ArrayBuffer | Uint8Array) {
    this.bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    const bytes = this.bytes, base = bytes.byteOffset, buffer = bytes.buffer;
    if (base % 4) fail("buffer byteOffset must be aligned to 4 bytes");
    if (bytes.length < PLACES_HEADER_BYTES) fail("truncated header");
    if (new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] !== 4) fail("little-endian host required");
    const h = this.header = new Uint32Array(buffer, base, PLACES_HEADER_BYTES / 4);
    if (h[0] !== PLACES_MAGIC) fail("magic");
    if (h[1] !== PLACES_VERSION) fail(`unsupported version ${h[1]}`);
    if (h[2] !== 0x01020304 || h[8] !== PLACES_HEADER_BYTES || h[3] !== bytes.length) fail("header or file length");
    if (h[6] >= NO_LOCAL_CATEGORY || Array.from(h.subarray(23)).some(Boolean)) fail("header counts or reserved words");
    if (placesChecksum(bytes) !== h[22]) fail("checksum");
    // Each section starts on a 4-byte boundary. Numeric lengths are determined by counts, never trusted offsets.
    let next = PLACES_HEADER_BYTES;
    const numeric = (word: number, count: number, width: number): number => {
      if (h[word] !== next || next + count * width > bytes.length) fail("section bounds or alignment");
      const start = next;
      next += aligned(count * width);
      for (let i = start + count * width; i < next; i++) if (bytes[i]) fail("section padding");
      return base + start;
    };
    const blob = (word: number, offsets: Uint32Array): Uint8Array => {
      const size = offsets[offsets.length - 1];
      const start = numeric(word, size, 1);
      return new Uint8Array(buffer, start, size);
    };
    this.nameOffsets = new Uint32Array(buffer, numeric(9, h[4] + 1, 4), h[4] + 1);
    this.names = blob(10, this.nameOffsets);
    this.nationalCategories = new Uint16Array(buffer, numeric(11, h[4], 2), h[4]);
    this.matchOffsets = new Uint32Array(buffer, numeric(12, h[4] + 1, 4), h[4] + 1);
    this.matchTowns = new Uint32Array(buffer, numeric(13, h[7], 4), h[7]);
    this.matchCategories = new Uint16Array(buffer, numeric(14, h[7], 2), h[7]);
    this.townOffsets = new Uint32Array(buffer, numeric(15, h[5] + 1, 4), h[5] + 1);
    this.towns = blob(16, this.townOffsets);
    this.categoryOffsets = new Uint32Array(buffer, numeric(17, h[6] + 1, 4), h[6] + 1);
    this.categories = blob(18, this.categoryOffsets);
    this.metadataOffsets = new Uint32Array(buffer, numeric(19, 4, 4), 4);
    this.metadata = blob(20, this.metadataOffsets);
    if (next !== bytes.length || h[21] !== next) fail("end offset");
    checkStrings(this.names, this.nameOffsets, true);
    checkStrings(this.towns, this.townOffsets, false);
    checkStrings(this.categories, this.categoryOffsets, false);
    checkStrings(this.metadata, this.metadataOffsets, false);
    if (this.matchOffsets[0] !== 0 || this.matchOffsets[h[4]] !== h[7]) fail("match offsets");
    for (let row = 0; row < h[4]; row++) {
      const category = this.nationalCategories[row];
      if (category !== NO_LOCAL_CATEGORY && category >= h[6]) fail("national category code");
      const start = this.matchOffsets[row], end = this.matchOffsets[row + 1];
      if (end < start || end > h[7]) fail("match range");
      for (let i = start; i < end; i++) {
        if (this.matchTowns[i] >= h[5] || this.matchCategories[i] >= h[6]) fail("town/category code");
        if (i > start && (this.matchTowns[i] < this.matchTowns[i - 1] || this.matchTowns[i] === this.matchTowns[i - 1]
          && this.matchCategories[i] < this.matchCategories[i - 1])) fail("town match ordering");
      }
    }
  }
  get version(): 1 { return 1; }
  get dataDate(): string { return textAt(this.metadata, this.metadataOffsets, 0); }
  get attribution(): string { return textAt(this.metadata, this.metadataOffsets, 1); }
  get source(): string { return textAt(this.metadata, this.metadataOffsets, 2); }
  rowFor(name: string): number {
    const query = localUtf8(name);
    let low = 0, high = this.nationalCategories.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(this.names, this.nameOffsets[middle], this.nameOffsets[middle + 1], query) < 0) low = middle + 1;
      else high = middle;
    }
    return low < this.nationalCategories.length && compare(this.names, this.nameOffsets[low], this.nameOffsets[low + 1], query) === 0 ? low : -1;
  }
  town(code: number): string { return textAt(this.towns, this.townOffsets, code); }
  category(code: number): string { return textAt(this.categories, this.categoryOffsets, code); }
}
