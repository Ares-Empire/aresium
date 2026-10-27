// Turns the bytes of a bank export into text. JavaScriptCore has no TextDecoder, so this is plain TypeScript.
// UTF-8 (with or without BOM) is taken when the bytes are valid UTF-8; otherwise the file is read as
// Windows-1252, which many German bank CSVs use (it equals ISO-8859-1 for every printable character and adds
// € and the typographic quotes at 0x80–0x9F). UTF-16 is read when the file starts with its byte order mark.

export type TextEncoding = "utf-8" | "windows-1252" | "utf-16le" | "utf-16be";

// Windows-1252 0x80–0x9F. The five bytes it leaves undefined map to the C1 control of the same value,
// as browsers do.
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

// Builds a string from code points without one huge argument list (large files would overflow the stack).
function fromCodePoints(points: number[]): string {
  let text = "";
  for (let i = 0; i < points.length; i += 8192) text += String.fromCodePoint(...points.slice(i, i + 8192));
  return text;
}

// Strict UTF-8: no overlong forms, no surrogates, nothing above U+10FFFF. Returns null when invalid.
function utf8(bytes: ArrayLike<number>, start: number): string | null {
  const points: number[] = [];
  for (let i = start; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { points.push(b); i++; continue; }
    let need: number, cp: number, min: number;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; min = 0x10000; }
    else return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    points.push(cp);
    i += need + 1;
  }
  return fromCodePoints(points);
}

function windows1252(bytes: ArrayLike<number>): string {
  const points: number[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    points[i] = b >= 0x80 && b <= 0x9f ? WINDOWS_1252_HIGH[b - 0x80] : b;
  }
  return fromCodePoints(points);
}

function utf16(bytes: ArrayLike<number>, littleEndian: boolean): string {
  const units: number[] = [];
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
  }
  let text = "";
  for (let i = 0; i < units.length; i += 8192) text += String.fromCharCode(...units.slice(i, i + 8192));
  return text;
}

export function decodeBankFileWithEncoding(bytes: ArrayLike<number>): { text: string; encoding: TextEncoding } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: utf16(bytes, true), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: utf16(bytes, false), encoding: "utf-16be" };
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = utf8(bytes, bom ? 3 : 0);
  if (text !== null) return { text, encoding: "utf-8" };
  return { text: windows1252(bytes), encoding: "windows-1252" };
}

// The text of a bank export, whatever of the encodings above it uses. Byte order marks are removed.
export function decodeBankFile(bytes: ArrayLike<number>): string {
  return decodeBankFileWithEncoding(bytes).text;
}
