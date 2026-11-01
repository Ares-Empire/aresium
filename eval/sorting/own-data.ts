// Read only, operator-only. Never log input values or errors from parsing the export.
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sortPayments, learn, type Learned } from "../../src/engine/sorting/sort.js";
import type { TransferPayment } from "../../src/engine/sorting/transfers.js";
import type { LocalPlacesInput } from "../../src/engine/sorting/local-places.js";
import { readLocalPlaces } from "./local-places-file.js";
import { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES } from "../../src/engine/categories.js";

type LedgerAccount = { id: string; iban?: string };
type LedgerPayment = { id: string; account: string; source: "bank" | "paypal"; externalId: string; bookingDate: string;
  amount: string; currency: string; text: string; counterparty?: string; counterpartyIban?: string;
  category?: string | null; categorySource: string; raw?: unknown; sequence: number };
export type LedgerExport = { app: "Aresium"; schema: number; accounts: LedgerAccount[]; payments: LedgerPayment[]; categories: { id: string }[] };
const defaultIds = new Set([...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES].map((c) => c.id));
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
export function parseExport(value: unknown): LedgerExport {
  const fail = () => { throw new Error("Invalid Aresium export; details withheld"); };
  if (!value || typeof value !== "object") return fail();
  const data = value as LedgerExport;
  if (data.app !== "Aresium" || !Number.isInteger(data.schema) || data.schema < 1 || data.schema > 6
    || !Array.isArray(data.accounts) || !Array.isArray(data.payments) || !Array.isArray(data.categories)) return fail();
  const ids = (list: { id: string }[]) => list.every((row) => row && text(row.id)) && new Set(list.map((row) => row.id)).size === list.length;
  if (!ids(data.accounts) || !ids(data.payments) || !ids(data.categories)) return fail();
  const accounts = new Set(data.accounts.map((a) => a.id));
  const categories = new Set([...data.categories.map((c) => c.id), "own-transfers"]);
  const keys = new Set<string>();
  for (const p of data.payments) {
    if (!p || !accounts.has(p.account) || !["bank", "paypal"].includes(p.source) || !text(p.externalId)
      || typeof p.bookingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.bookingDate)
      || !Number.isFinite(Date.parse(p.bookingDate)) || new Date(p.bookingDate).toISOString().slice(0, 10) !== p.bookingDate
      || typeof p.amount !== "string" || !/^-?\d+(\.\d+)?$/.test(p.amount) || !Number.isFinite(Number(p.amount))
      || typeof p.text !== "string" || !text(p.currency) || !Number.isInteger(p.sequence)
      || !["manual", "starter", "learned", "structural", "receipt", "none"].includes(p.categorySource)
      || (p.category != null && !categories.has(p.category))
      || ((p.category == null) !== (p.categorySource === "none"))
      || (p.counterparty != null && typeof p.counterparty !== "string")
      || (p.counterpartyIban != null && typeof p.counterpartyIban !== "string")) return fail();
    const key = JSON.stringify([p.account, p.source, p.externalId]);
    if (keys.has(key)) return fail(); keys.add(key);
  }
  return data;
}
export function ownCounts(data: LedgerExport, localPlaces?: LocalPlacesInput) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const sortedRows = data.payments.map((p, index) => ({ p, index })).sort((a, b) => a.p.bookingDate.localeCompare(b.p.bookingDate) || a.p.sequence - b.p.sequence || a.index - b.index);
  const originals = sortedRows.map(({ p }) => p);
  const payments: TransferPayment[] = originals.map((p) => ({ source: p.source, account: p.account, accountIban: accounts.get(p.account)?.iban,
    counterparty: p.counterparty, counterpartyIban: p.counterpartyIban, description: p.text, amount: Number(p.amount),
    date: p.bookingDate, currency: p.currency, externalId: p.externalId, raw: p.raw }));
  const predictions = sortPayments(payments, { categories: data.categories, learned: {}, localPlaces });
  const summary = { payments: payments.length, sorted: predictions.filter((p) => p.categoryId !== null).length,
    unsorted: predictions.filter((p) => p.categoryId === null).length,
    manual: { total: 0, agreement: 0 }, kept: { total: 0, agreement: 0 }, unlabelled: 0 };
  // Never print custom IDs/names: they can contain arbitrary personal text. Stable numbered aliases suffice.
  const aliases = new Map(data.categories.filter((c) => !defaultIds.has(c.id)).map((c, i) => [c.id, `custom-category-${i + 1}`]));
  const safeCategory = (id?: string | null) => id == null ? "unsorted" : defaultIds.has(id) ? id : aliases.get(id) ?? "unknown-category";
  const cells = new Map<string, { engine: string; chosen: string; count: number }>();
  originals.forEach((p, i) => {
    if (!p.category) summary.unlabelled++;
    else {
      const bucket = p.categorySource === "manual" ? summary.manual : summary.kept;
      bucket.total++; bucket.agreement += Number(predictions[i].categoryId === p.category);
    }
    const engine = safeCategory(predictions[i].categoryId), chosen = safeCategory(p.category), key = JSON.stringify([engine, chosen]);
    const cell = cells.get(key) ?? { engine, chosen, count: 0 }; cell.count++; cells.set(key, cell);
  });
  let learned: Learned = {};
  const months = new Map<string, { month: number; payments: number; labelled: number; sorted: number; right: number; fixes: number }>();
  let fixes = 0, first100 = 0, firstMonth = 0;
  originals.forEach((p, i) => {
    const predicted = sortPayments(payments.slice(0, i + 1), { categories: data.categories, learned, localPlaces })[i].categoryId;
    const month = p.bookingDate.slice(0, 7), counts = months.get(month) ?? { month: months.size + 1, payments: 0, labelled: 0, sorted: 0, right: 0, fixes: 0 };
    counts.payments++; counts.sorted += Number(predicted !== null);
    if (p.category) {
      counts.labelled++;
      if (predicted === p.category) counts.right++;
      else { counts.fixes++; fixes++; first100 += Number(i < 100); firstMonth += Number(month === originals[0].bookingDate.slice(0, 7)); learned = learn(learned, payments[i], p.category); }
    }
    months.set(month, counts);
  });
  return { ...summary, confusion: [...cells.values()].sort((a, b) => a.engine.localeCompare(b.engine) || a.chosen.localeCompare(b.chosen)),
    replay: { fixes, first100, firstMonth, months: [...months.values()] } };
}
export async function readOwnData(path: string, repo = fileURLToPath(new URL("../../", import.meta.url)), localPlaces?: LocalPlacesInput) {
  // Reject lexical traversal into the repository as well as symlinks into it. realpath handles /private on macOS.
  const inside = (root: string, input: string) => { const part = relative(root, input); return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part)); };
  if (inside(resolve(repo), resolve(path))) throw new Error("Export must stay outside the repository");
  const [actualRepo, actualInput] = await Promise.all([realpath(repo), realpath(path)]);
  if (inside(actualRepo, actualInput) || (await stat(actualInput)).nlink > 1) throw new Error("Export must stay outside the repository");
  return ownCounts(parseExport(JSON.parse(await readFile(actualInput, "utf8"))), localPlaces);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 3 && !(process.argv.length === 5 && process.argv[3] === "--local-places")) throw new Error();
    const localPlaces = process.argv[4] ? await readLocalPlaces(process.argv[4]) : undefined;
    console.log(JSON.stringify(await readOwnData(process.argv[2], undefined, localPlaces), null, 2));
  } catch { console.error("Own-data evaluation failed. Supply a valid Aresium schema 1–6 export outside the repository. Details withheld."); process.exitCode = 1; }
}
