// Aresium upload reminder (Telegram). Sends one message nudging me to export my latest
// VR Bank + PayPal statements and import them, with direct links to both sites. Fired by
// the aresium-remind.timer on the 1st and 15th of each month (see deploy/systemd/).
//
//   npm run remind        # send the reminder now
//
// No bot library: the Telegram Bot API is plain HTTPS, so a single fetch() does it.
// Credentials live in .env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) — never committed.
import "dotenv/config";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BANK_URL = process.env.ARESIUM_BANK_URL || "https://www.eu-banking.de";
const PAYPAL_URL = process.env.ARESIUM_PAYPAL_URL || "https://www.paypal.com";

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
  }

  const text =
    "🟥 <b>Aresium — time to update your data</b>\n\n" +
    "Grab your latest statements and import them into Aresium:\n\n" +
    `• <a href="${BANK_URL}">VR Bank (eu-banking.de)</a>\n` +
    `• <a href="${PAYPAL_URL}">PayPal</a>\n\n` +
    "Export the recent range as CSV, then hit <b>Import</b> in the dashboard.";

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram API error (${res.status}): ${data.description ?? JSON.stringify(data)}`);
  }
  console.log(`Reminder sent ✓ (message_id ${data.result?.message_id})`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
