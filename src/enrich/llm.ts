// Smart categorisation via Groq (free, OpenAI-compatible API). Runs as a second pass
// after keyword rules: sends each leftover transaction with its location/trip context
// and lets the model pick a category (or propose a new one). Sets categorySource='llm',
// so manual edits are never touched and rules stay authoritative for what they match.
import { prisma } from "../lib/db.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const BATCH = 25;

const SYSTEM = `You categorise bank/PayPal transactions for a German student who lives in their home city.
Assign each transaction to exactly ONE category from the provided "categories" list.
Guidelines:
- USER CORRECTIONS (HIGHEST PRIORITY): the user message includes a "corrections" list of {merchant, category} the user has manually assigned. These are ground truth. If a transaction's counterparty or description clearly refers to the same merchant as a corrections entry, assign that correction's category — this overrides every guideline below.
- ESSENTIALS WIN OVER LOCATION: categorise essentials by merchant type even on a trip — a supermarket is always "Groceries", a pharmacy "Health", a drugstore "Drogerie". Groceries bought during a holiday are still "Groceries", never "Vacation".
- "placeType" (when present) is what the merchant actually IS, resolved from OpenStreetMap — trust it over the raw name. restaurant→"Restaurants", bar/pub→"Drinking", cafe→"Restaurants", museum/attraction/entertainment→leisure (Travel/Vacation if onTrip, else "Non-essentials"), bakery→"Restaurants" or "Groceries", fuel→"Travel", fitness→"Fitness", clothes→"Clothes". placeType="unknown" means the lookup found nothing — fall back to the name.
- TRIPS: "onTrip": true means it happened away from the home cities (their home cities). "tripKind" tells you which:
    • "vacation" → a multi-day stay. Discretionary spending there (restaurants, bars, attractions, hotels, local transport, souvenirs) is "Vacation".
    • "travel" → a single en-route stop. Such spending, plus all long-distance transport (Deutsche Bahn/DB, flights, coaches), is "Travel".
  Long-distance transport is ALWAYS "Travel" even on a vacation.
- Transfers between own accounts, PayPal top-ups and investments are "Transfer".
- amount is negative for money spent, positive for money received.
- If no listed category fits well, propose a SHORT new category name (1-2 English words) and set isNew=true. Use "Vacation" for multi-day-trip leisure even if it is not yet in the list.
Return ONLY JSON: {"results":[{"id":"<id>","category":"<name>","isNew":<bool>,"confidence":<0..1>}]}`;

type LlmResult = { id: string; category: string; isNew?: boolean; confidence?: number };

type Correction = { merchant: string; category: string };

async function callGroq(key: string, categories: string[], corrections: Correction[], batch: unknown[]): Promise<LlmResult[]> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify({ categories, corrections, transactions: batch }) },
      ],
    }),
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 6000));
    return callGroq(key, categories, corrections, batch);
  }
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return (JSON.parse(content).results ?? []) as LlmResult[];
}

export async function categorizeWithLLM(opts: { all?: boolean } = {}): Promise<void> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY missing in .env (free key at console.groq.com)");

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const catNames = categories.map((c) => c.name);

  // User corrections become authoritative ground-truth examples for the model
  // (latest decision per merchant wins). This is how manual edits teach the AI.
  const corrRows = await prisma.categoryCorrection.findMany({ orderBy: { createdAt: "asc" } });
  const corrByMerchant = new Map<string, Correction>();
  for (const c of corrRows) corrByMerchant.set(c.merchant.toLowerCase(), { merchant: c.merchant, category: c.toCategory });
  const corrections = [...corrByMerchant.values()];
  if (corrections.length) console.log(`Honouring ${corrections.length} user correction(s) as ground truth.`);

  const todo = await prisma.transaction.findMany({
    where: opts.all ? { categorySource: { not: "manual" } } : { categorized: false },
    select: {
      id: true, description: true, counterparty: true, amount: true,
      bookingDate: true, city: true, country: true, trip: true, tripKind: true, placeType: true,
    },
    orderBy: { bookingDate: "desc" },
  });
  if (todo.length === 0) {
    console.log("Nothing to categorise.");
    return;
  }

  console.log(`Categorising ${todo.length} transactions with ${MODEL}...`);
  const created = new Set<string>();
  const tally = new Map<string, number>();
  let done = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const ids = new Set(slice.map((t) => t.id));
    const batch = slice.map((t) => ({
      id: t.id,
      description: t.description.slice(0, 120),
      counterparty: t.counterparty,
      amount: Number(t.amount),
      date: t.bookingDate.toISOString().slice(0, 10),
      city: t.city,
      country: t.country,
      onTrip: Boolean(t.trip),
      trip: t.trip,
      tripKind: t.tripKind,
      placeType: t.placeType && t.placeType !== "unknown" ? t.placeType : undefined,
    }));

    let results: LlmResult[];
    try {
      results = await callGroq(key, catNames, corrections, batch);
    } catch (e) {
      console.error(`\nBatch ${i}-${i + slice.length} failed: ${(e as Error).message}`);
      continue;
    }

    for (const r of results) {
      if (!r.id || !r.category || !ids.has(r.id)) continue; // ignore hallucinated ids
      let cat = catByName.get(r.category.toLowerCase());
      if (!cat) {
        cat = await prisma.category.create({ data: { name: r.category, color: "#a3a3a3", icon: "🏷️" } });
        catByName.set(cat.name.toLowerCase(), cat);
        created.add(cat.name);
      }
      await prisma.transaction
        .update({ where: { id: r.id }, data: { categoryId: cat.id, categorized: true, categorySource: "llm" } })
        .catch(() => {});
      tally.set(cat.name, (tally.get(cat.name) ?? 0) + 1);
      done++;
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone. Categorised ${done}/${todo.length}.`);
  console.log("Assignments:");
  for (const [name, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${name}${created.has(name) ? "  (NEW)" : ""}`);
  }
  if (created.size) console.log(`\nNew categories created: ${[...created].join(", ")} — rename/merge any you don't like.`);
}
