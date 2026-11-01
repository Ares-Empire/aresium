import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { ROOT, accepted, unsorted, validateAnswer, fingerprint, hash, heldback, readLines, writeLines, type Answer, type EvalCase, type JudgeAnswer, type Label } from "./model.js";
export function mergeAnswers(c: EvalCase, judges: [Answer, Answer]): Label & { allThree: boolean; exact: boolean } {
  const votes = [c.generator, ...judges];
  votes.forEach(validateAnswer);
  const sets = votes.map(accepted), unsortedVotes = votes.filter(unsorted).length;
  const candidates = [...new Set(sets.flat())].sort();
  const acceptedIds = candidates.filter((id) => sets.filter((set) => set.includes(id)).length >= 2);
  const unsortedRight = unsortedVotes >= 2;
  const allThree = unsortedVotes === 3 || candidates.some((id) => sets.every((set) => set.includes(id)));
  const signatures = votes.map((v) => JSON.stringify([accepted(v), unsorted(v)]));
  return { id: c.id, accepted: acceptedIds, unsortedRight, disputed: !acceptedIds.length && !unsortedRight, fingerprint: fingerprint(c), basis: "majority",
    allThree, exact: new Set(signatures).size === 1 };
}
export function judgeMap(rows: JudgeAnswer[], cases: EvalCase[]): Map<string, JudgeAnswer> {
  const allowed = new Set(cases.map((c) => c.id)), result = new Map<string, JudgeAnswer>();
  for (const row of rows) {
    validateAnswer(row);
    if (typeof row.id !== "string" || !allowed.has(row.id) || result.has(row.id)) throw new Error("Unknown or duplicate judge case ID");
    if (Object.keys(row).some((k) => !["id", "best", "alsoRight", "unclear", "personal"].includes(k))) throw new Error("Unexpected judge answer field");
    result.set(row.id, row);
  }
  if (result.size !== allowed.size) throw new Error("Judge must answer every case exactly once");
  return result;
}
export function blindCases(cases: EvalCase[]): { id: string; payment: EvalCase["payment"]; context?: EvalCase["payment"][] }[] {
  const groups = new Map<string, EvalCase["payment"][]>();
  for (const c of cases) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c.payment]);
  // Explicit allowlist prevents source facts or answer metadata being copied accidentally.
  const payment = (p: EvalCase["payment"]) => Object.fromEntries(Object.entries(p).filter(([key]) => ["counterparty", "description", "bookingText", "amount", "source", "account", "accountIban", "counterpartyIban", "currency", "date", "externalId", "raw"].includes(key)));
  return cases.map((c) => ({ id: c.id, payment: payment(c.payment), ...(c.group ? { context: groups.get(c.group)!.map(payment) } : {}) }))
    .sort((a, b) => hash(`blind:${a.id}`).localeCompare(hash(`blind:${b.id}`)));
}
export async function batches(cases: EvalCase[], directory = new URL("judging/", ROOT)): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) if (/^batch-\d+\.jsonl$/.test(name)) await unlink(new URL(name, directory));
  const blind = blindCases(cases);
  for (let i = 0; i < blind.length; i += 200) await writeLines(new URL(`batch-${String(i / 200 + 1).padStart(2, "0")}.jsonl`, directory), blind.slice(i, i + 200));
  await writeFile(new URL("categories.md", directory), await readFile(new URL("categories.md", ROOT), "utf8"));
  await writeFile(new URL("JUDGING.md", directory), await readFile(new URL("judging/JUDGING.md", ROOT), "utf8"));
  await writeFile(new URL("manifest.json", directory), JSON.stringify({ fingerprints: Object.fromEntries(cases.map((c) => [c.id, fingerprint(c)])) }, null, 2) + "\n");
  console.log(`Wrote ${Math.ceil(blind.length / 200)} blind batches (${blind.length} cases). Claude reviews the guide before judging.`);
}
export async function merge(cases: EvalCase[], first: string, second: string, root = ROOT): Promise<void> {
  const manifest = JSON.parse(await readFile(new URL("judging/manifest.json", root), "utf8")) as { fingerprints: Record<string, string> };
  if (Object.keys(manifest.fingerprints).length !== cases.length || cases.some((c) => manifest.fingerprints[c.id] !== fingerprint(c))) throw new Error("Cases changed since batches; regenerate batches and rejudge");
  const a = judgeMap(await readLines<JudgeAnswer>(first), cases), b = judgeMap(await readLines<JudgeAnswer>(second), cases);
  const merged = cases.map((c) => ({ c, label: mergeAnswers(c, [a.get(c.id)!, b.get(c.id)!]) }));
  const agreement: Record<string, { total: number; allThree: number; twoOfThreeOnly: number; disputed: number; exactSets: number; allThreeRate?: number; majorityRate?: number; twoOfThreeOnlyRate?: number }> = {};
  for (const { c, label } of merged) {
    const row = agreement[c.kind] ??= { total: 0, allThree: 0, twoOfThreeOnly: 0, disputed: 0, exactSets: 0 };
    row.total++; row.allThree += Number(label.allThree); row.twoOfThreeOnly += Number(!label.disputed && !label.allThree);
    row.disputed += Number(label.disputed); row.exactSets += Number(label.exact);
  }
  for (const row of Object.values(agreement)) { row.allThreeRate = row.allThree / row.total; row.twoOfThreeOnlyRate = row.twoOfThreeOnly / row.total; row.majorityRate = (row.total - row.disputed) / row.total; }
  const labels = merged.map(({ label: { allThree: _, exact: __, ...label } }) => label);
  await writeLines(new URL("labels.jsonl", root), labels.filter((l) => !heldback(l.id)));
  await writeLines(new URL("labels.heldback.jsonl", root), labels.filter((l) => heldback(l.id)));
  await writeLines(new URL("disputed.jsonl", root), merged.filter(({ c, label }) => !heldback(c.id) && label.disputed).map(({ c, label }) => ({ ...c, label, judge1: a.get(c.id), judge2: b.get(c.id) })));
  // Held-back disputes must only be opened by baseline adjudicators, never improvement work.
  await writeLines(new URL("disputed.heldback.jsonl", root), merged.filter(({ c, label }) => heldback(c.id) && label.disputed).map(({ c, label }) => ({ ...c, label, judge1: a.get(c.id), judge2: b.get(c.id) })));
  await writeFile(new URL("agreement.json", root), JSON.stringify(agreement, null, 2) + "\n");
  console.log(JSON.stringify(agreement, null, 2));
}
