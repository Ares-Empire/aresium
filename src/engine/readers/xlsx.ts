// OOXML tables only: no formulas are evaluated, external links followed or macros run.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decodeBankFile } from "./decode.js";
import { findProfile, profileLayout } from "./profiles.js";
import { BankFileError } from "./table.js";

const fail = (): never => { throw new BankFileError("xlsx", "This Excel workbook could not be read. Export it as CSV or save a new .xlsx file."); };
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false,
  trimValues: false, processEntities: true });
type Node = Record<string, any>;
const arr = <T>(x: T | T[] | undefined): T[] => x === undefined ? [] : Array.isArray(x) ? x : [x];
const text = (x: any): string => x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x);
const rich = (x: Node | undefined) => x ? text(x.t) + arr<Node>(x.r).map((r) => text(r.t)).join("") : "";
function xml(files: Map<string, Uint8Array>, path: string): Node {
  const bytes = files.get(path);
  if (!bytes) return fail();
  const source = decodeBankFile(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) return fail();
  try { return parser.parse(source); } catch { return fail(); }
}
export const isXlsx = (files: Map<string, Uint8Array>) => files.has("[Content_Types].xml") && files.has("xl/workbook.xml");
export const rowsText = (rows: string[][]) => rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\n");

// Expand exponent notation as digits, never via floating point arithmetic. Extra precision is retained so
// that sub-cent values cannot silently round into a different payment.
export function excelDecimal(value: string, money = false): string {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!m) return fail();
  const exponent = Number(m[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) return fail();
  const digits = m[2] + (m[3] ?? ""), point = m[2].length + exponent;
  const whole = (point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0")).replace(/^0+(?=\d)/, "");
  let fraction = point < 0 ? "0".repeat(-point) + digits : digits.slice(point);
  fraction = fraction.replace(/0+$/, "");
  if (money) fraction = fraction.padEnd(2, "0");
  return (m[1] === "-" && /[1-9]/.test(whole + fraction) ? "-" : "") + whole + (fraction ? "." + fraction : "");
}
const builtinDates = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function dateFormat(id: number, code: string): boolean {
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  return builtinDates.has(id) || /y|d/i.test(bare);
}
function serialDate(value: string, mac: boolean): string {
  const n = Number(excelDecimal(value));
  if (!Number.isFinite(n) || n < 0 || n > 2958465 || (!mac && Math.floor(n) === 60)) return fail();
  const days = Math.floor(n);
  const ms = (mac ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)) + (days - (!mac && days > 60 ? 1 : 0)) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function xlsxTableText(files: Map<string, Uint8Array>, hasTable: (text: string) => boolean): string {
  const workbook = xml(files, "xl/workbook.xml").workbook;
  if (!workbook) return fail();
  const rels = arr<Node>(xml(files, "xl/_rels/workbook.xml.rels").Relationships?.Relationship);
  const strings = files.has("xl/sharedStrings.xml") ? arr<Node>(xml(files, "xl/sharedStrings.xml").sst?.si).map(rich) : [];
  const style = files.has("xl/styles.xml") ? xml(files, "xl/styles.xml").styleSheet : {};
  const formats = new Map(arr<Node>(style?.numFmts?.numFmt).map((f) => [Number(f["@_numFmtId"]), String(f["@_formatCode"])]));
  const styles = arr<Node>(style?.cellXfs?.xf).map((f) => ({ id: Number(f["@_numFmtId"] ?? 0), code: formats.get(Number(f["@_numFmtId"])) ?? "" }));
  const mac = ["1", "true"].includes(String(workbook.workbookPr?.["@_date1904"]));
  for (const sheet of arr<Node>(workbook.sheets?.sheet)) {
    const rel = rels.find((r) => r["@_Id"] === sheet["@_id"]);
    if (!rel || rel["@_TargetMode"] === "External" || !String(rel["@_Type"]).endsWith("/worksheet")) return fail();
    const target = String(rel["@_Target"]);
    if (target.includes("..") || target.includes("\\")) return fail();
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const data = xml(files, path).worksheet?.sheetData;
    const rows: string[][] = [];
    const numeric: { row: number; col: number; value: string; money: boolean }[] = [];
    let width = 0, cells = 0;
    for (const row of arr<Node>(data?.row)) {
      const values: string[] = [];
      for (const cell of arr<Node>(row.c)) {
        if (++cells > 1000000) return fail();
        const ref = /^([A-Z]+)(\d+)$/.exec(String(cell["@_r"] ?? ""));
        if (cell["@_r"] !== undefined && !ref) return fail();
        let col = values.length;
        if (ref) { col = 0; for (const c of ref[1]) col = col * 26 + c.charCodeAt(0) - 64; col--; }
        if (col >= 16384 || col < values.length) return fail();
        while (values.length <= col) values.push("");
        // Cached formulas and errors may be stale or hide a booking; refuse rather than trust them.
        if (cell.f !== undefined || cell["@_t"] === "e") return fail();
        const value = text(cell.v), kind = cell["@_t"];
        if (kind !== undefined && !["s", "inlineStr", "b", "str", "d", "n"].includes(kind)) return fail();
        const styleIndex = Number(cell["@_s"] ?? 0);
        if (!Number.isInteger(styleIndex) || styleIndex < 0 || (styleIndex > 0 && !styles[styleIndex])) return fail();
        if (kind === "s") {
          if (!/^\d+$/.test(value) || strings[Number(value)] === undefined) return fail();
          values[col] = strings[Number(value)];
        } else if (kind === "inlineStr") values[col] = rich(cell.is);
        else if (kind === "b") { if (value !== "0" && value !== "1") return fail(); values[col] = value === "1" ? "true" : "false"; }
        else if (kind === "str" || kind === "d") values[col] = value;
        else if (value !== "") {
          const s = styles[styleIndex] ?? { id: 0, code: "" };
          if (dateFormat(s.id, s.code)) values[col] = serialDate(value, mac);
          else {
            const money = [2, 4, 7, 8, 39, 40, 43, 44].includes(s.id) || /[0#][.,]00|[$€£]/.test(s.code);
            values[col] = excelDecimal(value, money);
            numeric.push({ row: rows.length, col, value, money });
          }
        }
      }
      width = Math.max(width, values.length);
      rows.push(values);
    }
    // Excel omits empty trailing cells. Keep all rows at the table width for the existing completeness check.
    if (rows.length * width > 1000000) return fail();
    rows.forEach((r) => { while (r.length < width) r.push(""); });
    const known = findProfile(rows);
    const layout = known ? profileLayout(known.profile, rows, known.headerRow, ";") : undefined;
    const moneyColumns = layout ? new Set([layout.columns.amount, layout.columns.debit, layout.columns.credit, layout.columns.balance,
      ...(layout.columns.fees ?? []), ...(layout.columns.addAmounts ?? [])]) : new Set<number | undefined>();
    // Money cells use two decimal places even with General formatting. This also preserves the legacy VR ids
    // where the source CSV used its normal two decimals. Text cells are never rewritten.
    for (const c of numeric) if (c.money || moneyColumns.has(c.col)) rows[c.row][c.col] = excelDecimal(c.value, true);
    const table = rowsText(rows);
    if (hasTable(table)) return table;
  }
  // The frozen seed-78 renamed workbook has no bank table and retains its original refusal code.
  throw new BankFileError("zip", "No bank payment table was found in this Excel workbook. Export a bank statement as CSV or .xlsx.");
}
