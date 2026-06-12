// Aresium upload reminder (Telegram, oneshot). Nudges me to export my latest VR Bank +
// PayPal statements and import them, with direct links to both sites. Fired by the
// aresium-remind.timer on the 1st and 15th (see deploy/systemd/). Sends only to my own
// Telegram ID (tgSend defaults to ALLOWED_ID).
//
//   npm run remind        # send the reminder now
import "dotenv/config";
import { assertConfig, tgSend } from "./telegram.js";

const BANK_URL = process.env.ARESIUM_BANK_URL || "https://www.eu-banking.de";
const PAYPAL_URL = process.env.ARESIUM_PAYPAL_URL || "https://www.paypal.com";

async function main() {
  assertConfig();
  const text =
    "<b>Aresium — time to update your data</b>\n\n" +
    "Grab your latest statements and import them into Aresium:\n\n" +
    `• <a href="${BANK_URL}">VR Bank (eu-banking.de)</a>\n` +
    `• <a href="${PAYPAL_URL}">PayPal</a>\n\n` +
    "Export the recent range as CSV, then hit <b>Import</b> in the dashboard.";
  const result = (await tgSend(text)) as { message_id?: number };
  console.log(`Reminder sent ✓ (message_id ${result?.message_id})`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
