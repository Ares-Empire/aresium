// A forgiving CSV splitter for bank exports: quoted fields, doubled quotes inside them, separators and line
// breaks inside quotes, CRLF or LF. Detection can use the forgiving rows from a prefix; actual imports also
// check `damaged`, so an unfinished quoted field can never turn a broken download into a partial success.

export type Separator = ";" | "," | "\t" | "|";
export const SEPARATORS: readonly Separator[] = [";", ",", "\t", "|"];

export function splitCsv(text: string, separator: Separator): string[][] {
  return inspectCsv(text, separator).rows;
}

export function inspectCsv(text: string, separator: Separator): { rows: string[][]; damaged: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false; // inside a quoted part
  let fieldStarted = false; // the field has content (so a quote is literal text, not an opening quote)
  let closed = false, damaged = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
      continue;
    }
    if (ch === '"' && !fieldStarted) { quoted = true; fieldStarted = true; continue; }
    if (ch === separator) { row.push(field); field = ""; fieldStarted = false; closed = false; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = []; field = ""; fieldStarted = false; closed = false;
      continue;
    }
    if (closed && ch.trim() !== "") damaged = true;
    field += ch;
    if (ch !== " ") fieldStarted = true;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return { rows, damaged: damaged || quoted };
}

// Counts separators outside quotes, per line, for the first lines of the file.
function countsPerLine(text: string, separator: Separator, maxLines: number): number[] {
  const counts: number[] = [];
  let count = 0, quoted = false;
  for (let i = 0; i < text.length && counts.length < maxLines; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === separator) count++;
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      counts.push(count);
      count = 0;
    }
  }
  if (counts.length < maxLines && count > 0) counts.push(count);
  return counts;
}

// The separator whose count is the same on the most lines (the table), preferring ";" on a tie, since German
// banks use it and their amounts contain commas.
export function detectSeparator(text: string): Separator {
  let best: Separator = ";", bestScore = -1;
  for (const separator of SEPARATORS) {
    const counts = countsPerLine(text, separator, 200).filter((n) => n > 0);
    const frequency = new Map<number, number>();
    for (const n of counts) frequency.set(n, (frequency.get(n) ?? 0) + 1);
    let score = 0;
    for (const [n, lines] of frequency) if (n >= 1 && lines * Math.min(n, 4) > score) score = lines * Math.min(n, 4);
    if (score > bestScore) { best = separator; bestScore = score; }
  }
  return best;
}
