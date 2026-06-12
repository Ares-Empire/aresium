// Shared Telegram Bot API helpers (no bot library — the API is plain HTTPS).
// Credentials come from .env; ALLOWED_ID is the only chat the bot ever talks to / obeys.
import "dotenv/config";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const ALLOWED_ID = process.env.TELEGRAM_CHAT_ID;

export function assertConfig(): void {
  if (!TOKEN || !ALLOWED_ID) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
}

const api = (method: string) => `https://api.telegram.org/bot${TOKEN}/${method}`;

type TgResult<T> = { ok: boolean; result?: T; description?: string };

// Send a message. Defaults to ALLOWED_ID so the bot can only ever message me.
export async function tgSend(text: string, chatId: string = ALLOWED_ID ?? ""): Promise<unknown> {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const data = (await res.json()) as TgResult<unknown>;
  if (!res.ok || !data.ok) throw new Error(`Telegram sendMessage (${res.status}): ${data.description ?? "failed"}`);
  return data.result;
}

export type TgUpdate = {
  update_id: number;
  message?: { text?: string; from?: { id?: number } };
};

// Long-poll for updates. `timeout` (s) holds the connection open server-side until a
// message arrives (efficient — no busy looping).
export async function tgGetUpdates(offset: number, timeout = 50): Promise<TgUpdate[]> {
  const qs = `?timeout=${timeout}&allowed_updates=%5B%22message%22%5D` + (offset ? `&offset=${offset}` : "");
  const res = await fetch(api("getUpdates") + qs);
  const data = (await res.json()) as TgResult<TgUpdate[]>;
  if (!res.ok || !data.ok) throw new Error(`Telegram getUpdates (${res.status}): ${data.description ?? "failed"}`);
  return data.result ?? [];
}
