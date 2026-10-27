// Vision's text pieces → the receipt's lines. A receipt's left text and its right-aligned price come as separate
// pieces; pieces whose vertical centres are close are one line, read left to right ("SUMME EUR" + "23,40").

/** One recognised text piece. Box normalised 0–1, origin top left, y growing downwards; page n's y is offset by n. */
export type Observation = { text: string; x: number; y: number; width: number; height: number };

type Piece = { text: string; left: number; right: number; cx: number; cy: number; height: number };

// Vision sometimes returns a Cyrillic or Greek letter that looks like a Latin one inside Latin text, also with only
// Latin languages asked for ("3,49 А" with a Cyrillic А, "в 19,0%" for the VAT letter B). Lower-case в, к, м, н and
// т look like small capitals of B, K, M, H and T, so they become those capitals.
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  // Cyrillic
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "I", Ј: "J", Ѕ: "S",
  Ԛ: "Q", Ԝ: "W", а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԛ: "q", ԝ: "w",
  в: "B", к: "K", м: "M", н: "H", т: "T",
  // Greek
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  α: "a", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", υ: "u", χ: "x",
};
const OTHER_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/gu;
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{N}]/gu;

/**
 * Cyrillic and Greek look-alikes as Latin letters, where they stand in Latin text: in a word that also has Latin
 * letters or digits ("SUMMЕ"), or as a single letter on a line that is mostly Latin letters and digits ("в 19,0%").
 * A word wholly in Cyrillic or Greek, and a line mostly in them, stay as they are.
 */
export function latinLookAlikes(text: string): string {
  const other = text.match(OTHER_SCRIPT)?.length ?? 0;
  if (other === 0) return text;
  const latin = text.match(LATIN_OR_DIGIT)?.length ?? 0;
  return text.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const mixed = /[\p{Script=Latin}\p{N}]/u.test(word);
    const single = [...word].length === 1 && latin > other;
    return mixed || single ? [...word].map((c) => LOOK_ALIKES[c] ?? c).join("") : word;
  });
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The page's tilt as the slope of its lines (dy per dx): the median over pairs of pieces side by side whose centres
 * are nearly level. A scanned receipt is straightened by the scanner, so the tilt is slight; the median ignores the
 * odd pair from neighbouring lines.
 */
function slopeOf(pieces: Piece[], height: number): number {
  const slopes: number[] = [];
  for (const a of pieces) for (const b of pieces) {
    if (b.left < a.right || b.cx - a.cx < 0.05) continue; // b must stand right of a
    const dy = b.cy - a.cy;
    if (Math.abs(dy) < 0.6 * height) slopes.push(dy / (b.cx - a.cx));
  }
  return median(slopes);
}

/**
 * The receipt's lines, top to bottom, each its pieces left to right joined by single spaces, with look-alike letters
 * made Latin (the app keeps these lines and searches them; the shop's name is taken from them).
 */
export function receiptRows(observations: readonly Observation[]): string[] {
  const pieces: Piece[] = [];
  for (const o of observations ?? []) {
    const text = typeof o?.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
    if (!text || ![o.x, o.y, o.width, o.height].every(finite)) continue;
    pieces.push({ text, left: o.x, right: o.x + o.width, cx: o.x + o.width / 2, cy: o.y + o.height / 2, height: Math.abs(o.height) });
  }
  // Pages are offset by whole numbers: each page is straightened on its own.
  const pages = new Map<number, Piece[]>();
  for (const p of pieces) {
    const page = Math.floor(p.cy);
    pages.set(page, [...(pages.get(page) ?? []), p]);
  }
  const rows: string[] = [];
  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const onPage = pages.get(page)!;
    const height = median(onPage.map((p) => p.height)) || 0.01;
    const slope = slopeOf(onPage, height);
    // The centre as if the page were level, measured at the left edge.
    const level = (p: Piece) => p.cy - slope * p.cx;
    const ordered = [...onPage].sort((a, b) => level(a) - level(b) || a.left - b.left);
    const lines: { y: number; pieces: Piece[] }[] = [];
    for (const p of ordered) {
      const line = lines.at(-1);
      // Same line when level with it and not on top of a piece already in it (two pieces at one x are two lines).
      const overlaps = line?.pieces.some((q) => Math.min(q.right, p.right) - Math.max(q.left, p.left) > 0.3 * Math.min(q.right - q.left, p.right - p.left));
      if (line && Math.abs(level(p) - line.y) <= 0.5 * height && !overlaps) {
        line.pieces.push(p);
        line.y = line.pieces.reduce((sum, q) => sum + level(q), 0) / line.pieces.length;
      } else {
        lines.push({ y: level(p), pieces: [p] });
      }
    }
    for (const line of lines) rows.push(latinLookAlikes(line.pieces.sort((a, b) => a.left - b.left).map((p) => p.text).join(" ")));
  }
  return rows;
}
