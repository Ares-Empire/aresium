// The only database entry point in the bench. Never run this on a developer Mac.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DATA_FILE, parseData, type BenchPayment } from "./data.js";

export async function exportData(): Promise<void> {
  const { prisma } = await import("../src/lib/db.js");
  try {
    const rows = await prisma.transaction.findMany({
      where: { categorySource: { in: ["rule", "manual"] } },
      select: { bookingDate: true, amount: true, description: true, counterparty: true, category: { select: { name: true } } },
      orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
    });
    const payments: BenchPayment[] = rows.map((row, index) => ({
      reference: `payment-${index + 1}`, date: row.bookingDate.toISOString().slice(0, 10),
      amount: Number(row.amount), description: row.description, counterparty: row.counterparty,
      trueCategory: row.category?.name ?? "",
    }));
    parseData(payments);
    await mkdir(new URL("out/", import.meta.url), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(payments) + "\n", { mode: 0o600 });
    console.log(`Exported ${payments.length} answer-key payments.`);
  } finally { await prisma.$disconnect(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await exportData(); } catch { console.error("Export failed; details withheld to protect payment data."); process.exitCode = 1; }
}
