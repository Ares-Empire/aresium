import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES } from "../../src/engine/categories.js";
import type { TransferPayment } from "../../src/engine/sorting/transfers.js";

export type Answer = { best?: string | null; alsoRight?: string[]; unclear?: boolean; personal?: boolean };
export type Kind = "osm" | "brand" | "madeup" | "nonshop" | "scenario";
export type EvalCase = {
  id: string; kind: Kind; payment: TransferPayment; generator: Answer;
  rendering: { layout: string; variation: string; service: string; line: string };
  facts: Record<string, unknown>; inShopList?: boolean; group?: string; twinOf?: string;
};
export type Label = { id: string; accepted: string[]; unsortedRight: boolean; disputed: boolean; fingerprint: string; basis: "generator" | "majority" };
export type JudgeAnswer = Answer & { id: string };
export const ROOT = new URL("./", import.meta.url);
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Twins and scenario sides share the opaque case-id stem, keeping context and renderings in one partition.
export const heldback = (id: string) => Number.parseInt(hash(id.split(".")[0]).slice(0, 8), 16) / 2 ** 32 < 0.3;
export const fingerprint = (c: EvalCase) => hash(JSON.stringify(c));
export const categories = new Set([...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES].map((c) => c.id).filter((c) => c !== "not-sorted"));
export const accepted = (a: Answer) => [...new Set([...(a.best ? [a.best] : []), ...(a.alsoRight ?? [])])].sort();
export const unsorted = (a: Answer) => a.unclear === true || a.personal === true;
export function validateAnswer(a: Answer): void {
  if (!a || typeof a !== "object" || (a.best !== undefined && a.best !== null && typeof a.best !== "string")
    || (a.alsoRight !== undefined && (!Array.isArray(a.alsoRight) || a.alsoRight.some((id) => typeof id !== "string")))
    || [a.unclear, a.personal].some((v) => v !== undefined && typeof v !== "boolean")
    || accepted(a).some((id) => !categories.has(id)) || (!accepted(a).length && !unsorted(a))) throw new Error("Invalid answer");
}
export async function readLines<T>(path: URL | string): Promise<T[]> {
  return (await readFile(path, "utf8")).split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s) as T);
}
export const writeLines = (path: URL | string, rows: unknown[]) => writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
export async function loadCases(): Promise<EvalCase[]> {
  const rows = [...await readLines<EvalCase>(new URL("cases.jsonl", ROOT)), ...await readLines<EvalCase>(new URL("cases.heldback.jsonl", ROOT))];
  if (new Set(rows.map((c) => c.id)).size !== rows.length) throw new Error("Duplicate case ID");
  rows.forEach((c) => validateAnswer(c.generator));
  return rows;
}
export const initialLabel = (c: EvalCase): Label => ({ id: c.id, accepted: accepted(c.generator), unsortedRight: unsorted(c.generator), disputed: false, fingerprint: fingerprint(c), basis: "generator" });
