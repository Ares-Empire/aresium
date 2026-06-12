// Aresium Telegram bot — command listener (long-running). Replies ONLY to my own
// Telegram ID (ALLOWED_ID); every other sender is ignored. Commands:
//
//   current   → this month's expenses (the latest month of uploaded data) + top categories
//   help      → usage
//
//   npm run bot              # start the listener (run as a service, see deploy/systemd/)
//   npm run bot -- --current # print the "current" summary once and exit (diagnostic, no send)
//
// Runs alongside the oneshot reminder (remind.ts); both share telegram.ts. Only this
// process calls getUpdates, so there's no polling conflict.
import "dotenv/config";
import { prisma } from "../lib/db.js";
import { assertConfig, ALLOWED_ID, tgSend, tgGetUpdates, type TgUpdate } from "./telegram.js";
import { getOverview, getMonth } from "../data/queries.js";

const eur = (n: number) => "€" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// "current" = the latest month that has uploaded data.
async function currentSummary(): Promise<string> {
  const ov = await getOverview();
  if (!ov.monthly.length) return "No data imported yet — upload your statements first.";
  const last = ov.monthly[ov.monthly.length - 1];
  const md = await getMonth(last.month);
  const cats = md.categories.filter((c) => !c.excluded && c.spend > 0).slice(0, 6);
  const top = cats.length ? "\n\n<b>Top categories</b>\n" + cats.map((c) => `• ${c.name}: ${eur(c.spend)}`).join("\n") : "";
  return (
    `📊 <b>${monthLabel(last.month)}</b>\n\n` +
    `Expenses: <b>${eur(last.expenses)}</b>\n` +
    `Income: ${eur(last.income)}` +
    top
  );
}

async function handle(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;
  if (String(msg.from?.id) !== String(ALLOWED_ID)) return; // allowlist — ignore everyone else
  const cmd = msg.text.trim().toLowerCase().replace(/^\//, "");
  if (cmd === "current") {
    await tgSend(await currentSummary());
  } else if (cmd === "start" || cmd === "help") {
    await tgSend("👋 Send <b>current</b> to see this month's expenses.");
  } else {
    await tgSend("Unknown command. Send <b>current</b> for this month's expenses.");
  }
}

async function loop(): Promise<void> {
  assertConfig();
  console.log("Aresium Telegram bot — polling…");
  // Skip any backlog so messages sent while the bot was down aren't replayed on boot.
  let offset = 0;
  const backlog = await tgGetUpdates(0, 0);
  if (backlog.length) offset = backlog[backlog.length - 1].update_id + 1;

  for (;;) {
    try {
      const updates = await tgGetUpdates(offset, 50);
      for (const u of updates) {
        offset = u.update_id + 1;
        try { await handle(u); } catch (e) { console.error("handle error:", (e as Error).message); }
      }
    } catch (e) {
      console.error("poll error:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main() {
  if (process.argv.includes("--current")) {
    // diagnostic: print the summary (with tags stripped) and exit; no Telegram calls
    const text = (await currentSummary()).replace(/<[^>]+>/g, "");
    console.log(text);
    await prisma.$disconnect();
    return;
  }
  await loop();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
