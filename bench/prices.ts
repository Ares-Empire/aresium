// USD per million tokens. Legacy public rates are estimates, not current enterprise quotes.
// Checked 2026-10-26: the Llama models now require an enterprise contract.
export const PRICE_SOURCE = "https://console.groq.com/docs/models";
export const PRICE_DATE = "2026-10-26";
export const PRICES: Readonly<Record<string, { input: number; output: number; legacy?: boolean }>> = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79, legacy: true },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08, legacy: true },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.60 },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.30 },
  "qwen/qwen3.8-27b": { input: 0.80, output: 4.00 },
};
