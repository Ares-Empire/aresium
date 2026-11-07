// ZIP stays in memory. Inspect the directory before inflating; bound actual output too, since directory sizes
// can lie. Small compressed chunks bound the temporary allocation made by the streaming inflater.
import { Inflate, strFromU8 } from "fflate";
import { decodeBankFileWithEncoding } from "./decode.js";
import { BankFileError } from "./table.js";

export const ZIP_MAX_BYTES = 50 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 2000;
export const isZip = (b: ArrayLike<number>) => b[0] === 0x50 && b[1] === 0x4b
  && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));
const bad = (): never => { throw new BankFileError("zip", "This ZIP archive is damaged or uses an unsupported ZIP format."); };
const limit = (): never => { throw new BankFileError("zipLimit", "The ZIP archive exceeds 50 MB unpacked or 2,000 entries."); };
const encrypted = (): never => { throw new BankFileError("zipEncrypted", "Encrypted ZIP files cannot be read. Export an unencrypted bank file."); };
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  return c;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const v of b) c = (c >>> 8) ^ crcTable[(c ^ v) & 255];
  return (c ^ 0xffffffff) >>> 0;
};

export function unzipBankFile(input: ArrayLike<number>): Map<string, Uint8Array> {
  const b = Uint8Array.from(input);
  const u16 = (p: number) => { if (p < 0 || p + 2 > b.length) return bad(); return b[p] | b[p + 1] << 8; };
  const u32 = (p: number) => (u16(p) + u16(p + 2) * 65536) >>> 0;
  const entryName = (start: number, length: number, flags: number) => {
    const bytes = b.subarray(start, start + length);
    // Legacy names are byte keys only; bank detection uses contents and ASCII suffixes. Use our strict
    // UTF-8 decoder for flagged names so Node and JavaScriptCore reject the same damaged bytes.
    if (!(flags & 0x800)) return strFromU8(bytes, true).replace(/\\/g, "/");
    const decoded = decodeBankFileWithEncoding(bytes);
    if (decoded.encoding !== "utf-8") return bad();
    return decoded.text.replace(/\\/g, "/");
  };
  let end = b.length - 22;
  for (; end >= Math.max(0, b.length - 65557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === b.length) break;
  }
  if (end < 0 || u32(end) !== 0x06054b50) return bad();
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) return bad();
  const count = u16(end + 10), directory = u32(end + 16);
  if (count > ZIP_MAX_ENTRIES) limit();
  if (directory + u32(end + 12) !== end) return bad();
  type Entry = { name: string; size: number; packed: number; start: number; method: number; crc: number };
  const entries: Entry[] = [];
  const names = new Set<string>();
  let p = directory, total = 0;
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) return bad();
    const flags = u16(p + 8), method = u16(p + 10), packed = u32(p + 20), size = u32(p + 24);
    const len = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32), local = u32(p + 42);
    if (flags & 0x41) encrypted();
    total += size;
    if (total > ZIP_MAX_BYTES) limit();
    if (p + 46 + len + extra + comment > end || u16(p + 34) || local >= directory) return bad();
    const name = entryName(p + 46, len, flags);
    if (!name || name.startsWith("/") || name.split("/").includes("..") || names.has(name)) return bad();
    names.add(name);
    if (u32(local) !== 0x04034b50) return bad();
    const localFlags = u16(local + 6);
    if (localFlags & 0x41) encrypted();
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (localFlags !== flags || u16(local + 8) !== method || start + packed > directory
      || entryName(local + 30, u16(local + 26), flags) !== name) return bad();
    if (!(flags & 8) && (u32(local + 18) !== packed || u32(local + 22) !== size || u32(local + 14) !== u32(p + 16))) return bad();
    if (method !== 0 && method !== 8) return bad();
    entries.push({ name, size, packed, start, method, crc: u32(p + 16) });
    p += 46 + len + extra + comment;
  }
  if (p !== end) return bad();
  const result = new Map<string, Uint8Array>();
  let actual = 0;
  for (const e of entries) {
    // Count ignored files in both limits, but never interpret their contents.
    const chunks: Uint8Array[] = [];
    let length = 0;
    const take = (chunk: Uint8Array) => {
      length += chunk.length; actual += chunk.length;
      if (actual > ZIP_MAX_BYTES) limit();
      if (length > e.size) return bad();
      chunks.push(chunk);
    };
    try {
      if (e.method === 0) take(b.subarray(e.start, e.start + e.packed));
      else {
        const inflater = new Inflate(take);
        for (let n = 0; n < e.packed; n += 256) inflater.push(b.subarray(e.start + n, e.start + Math.min(n + 256, e.packed)), n + 256 >= e.packed);
      }
    } catch (error) { if (error instanceof BankFileError) throw error; return bad(); }
    if (length !== e.size) return bad();
    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    if (crc32(out) !== e.crc) return bad();
    if (!e.name.endsWith("/") && !e.name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX")) result.set(e.name, out);
  }
  return result;
}
