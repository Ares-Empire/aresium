// The test sets' shared score history (eval/history.csv): one row per recording, the same four columns for every
// suite, its numbers as one JSON cell. Each suite decides what its numbers are; this file only keeps the format.
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export const HISTORY_HEADER = "date,commit,suite,metrics\n";

/** Appends one row; creates the file with its header first. Refuses a file in any other format, changing nothing. */
export async function appendHistory(path: string, suite: string, commit: string, metrics: unknown,
                                    date = new Date().toISOString()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "ax");
    try { await handle.writeFile(HISTORY_HEADER); } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const existing = await readFile(path, "utf8");
  if (!existing.startsWith(HISTORY_HEADER) || !existing.endsWith("\n")) {
    throw new Error(`Unexpected history format in ${path}; expected ${HISTORY_HEADER.trim()}.`);
  }
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  await appendFile(path, [date, commit, suite, JSON.stringify(metrics)].map(cell).join(",") + "\n");
}
