import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { dashboardSourceFromRows } from "./queries.js";
import { buildLedgerDashboard, emptyLedgerSettings, type LedgerSettings } from "../engine/ledger-dashboard.js";
import { DEFAULT_CATEGORIES, categoryLook } from "../engine/categories.js";
import { sortPayments } from "../engine/sorting/sort.js";
import { selectionSummary } from "../engine/selection.js";
import { merchantKey } from "../engine/sorting/merchant.js";
import { shopIdentities } from "../engine/sorting/shop-identity.js";
import { parseDay } from "../engine/dates.js";
import { randomUUID, createHash } from "node:crypto";
import { paybackChoices, planPaybacks, applyPlan, centAmount } from "../engine/payback-plan.js";
import { markID } from "../engine/fixed-costs.js";
import { berlinDay } from "./calendar.js";

type DB = Prisma.TransactionClient;
export class LedgerError extends Error {
  constructor(public status: number, public english: string, public german: string) {
    super(english);
  }
}
export const changed = () => new LedgerError(
  409,
  "The payments changed meanwhile. Try again.",
  "Die Zahlungen haben sich inzwischen geändert. Versuch es noch einmal.");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function readSettings(db: DB = prisma): Promise<LedgerSettings> {
  const row = await db.webSettings.findUnique({
    where: {
      id: "owner"
    }
  });
  const settings = {
    ...emptyLedgerSettings(),
    ...(row?.data as unknown as Partial<LedgerSettings> ?? {})
  };
  // Merchant names are untrusted keys (for example "constructor"); use dictionaries without prototypes.
  for (const key of ["names", "paymentNames", "links", "learned"] as const)
    settings[key] = Object.assign(Object.create(null), settings[key]);
  return settings;
}
async function saveSettings(db: DB, settings: LedgerSettings) {
  await db.webSettings.upsert(
    {
      where: {
        id: "owner"
      },
      create: {
        id: "owner",
        data: json(settings)
      },
      update: {
        data: json(settings)
      }
    });
}
export async function webDashboard(db?: DB, now = new Date()): Promise<Awaited<ReturnType<typeof buildWebDashboard>>> {
  return db
    ? buildWebDashboard(db, now)
    : prisma.$transaction((tx) => buildWebDashboard(tx, now), {
      isolationLevel: "RepeatableRead"
    });
}
async function buildWebDashboard(db: DB, now: Date) {
  const transactions = await db.transaction.findMany(
    {
      include: {
        category: true,
        tags: {
          include: {
            category: true
          }
        }
      },
      orderBy: [
        {
          bookingDate: "asc"
        },
        {
          createdAt: "asc"
        },
        {
          id: "asc"
        }
      ]
    });
  const categories = await db.category.findMany({
    where: {
      removed: false
    }
  });
  const settings = await readSettings(db);
  const { source } = dashboardSourceFromRows({
    transactions,
    categories
  }, now, settings.links, settings.cashEntries);
  const importOrder = transactions.slice().sort((a, b) =>
    a.createdAt?.getTime() - b.createdAt?.getTime() || a.id.localeCompare(b.id));
  const sequence = new Map(importOrder.map((payment, index) => [payment.id, index]));
  const dashboard = buildLedgerDashboard(
    source,
    [
      ...transactions.map(
        (t) => ({
          id: t.id,
          counterparty: t.counterparty,
          description: t.description,
          amount: Number(t.amount),
          currency: t.currency,
          categorySource: t.categorySource,
          sequence: sequence.get(t.id)
        })),
      ...settings.cashEntries.map(
        (p, i) => ({
          id: p.id,
          counterparty: p.shop,
          description: p.shop || "",
          amount: p.direction === "in" ? p.total : -p.total,
          currency: "EUR",
          categorySource: "receipt",
          sequence: transactions.length + i
        }))
    ],
    settings,
    berlinDay(now));
  const allCategories = await db.category.findMany({
    orderBy: {
      name: "asc"
    }
  });
  return {
    ...dashboard,
    cashEntries: settings.cashEntries,
    categoryOptions: allCategories.map(
      (c) => ({
        ...c,
        kind: c.excludeFromTotals
          ? "transfer"
          : c.side ?? dashboard.categories.find((m) => m.name === c.name)?.kind ?? "spend",
        default: !!defaultCategory(c.originalName || c.name),
        protected: protectedCategory(c.originalName || c.name),
        paymentCount: transactions.filter((p) =>
          p.categoryId === c.id || p.tags.some((tag) => tag.categoryId === c.id)).length
      }))
  };
}
async function snapshot(db: DB) {
  const transactions = await db.transaction.findMany({
    include: {
      tags: true
    },
    orderBy: {
      id: "asc"
    }
  });
  const categories = await db.category.findMany({
    orderBy: {
      id: "asc"
    }
  });
  const rules = await db.categoryRule.findMany({
    orderBy: {
      id: "asc"
    }
  });
  const paymentStates = transactions.map(
    (p) => ({
      id: p.id,
      categoryId: p.categoryId ?? null,
      categorySource: p.categorySource ?? null,
      categorized: p.categorized ?? false,
      tags: p.tags.map((tag) => ({
        categoryId: tag.categoryId
      })).sort((a, b) => a.categoryId.localeCompare(b.categoryId)),
      stamp: digest(
        [
          p.externalId,
          p.source,
          String(p.amount),
          p.currency,
          p.bookingDate,
          p.balance,
          p.description,
          p.counterparty,
          p.raw
        ]),
    }));
  return {
    transactions: paymentStates,
    categories: JSON.parse(JSON.stringify(categories)),
    rules: JSON.parse(JSON.stringify(rules)),
    settings: await readSettings(db)
  };
}
export async function changeLedger(change: (db: DB, settings: LedgerSettings) => Promise<void>) {
  return prisma.$transaction(
    async (db) => {
      const before = await snapshot(db);
      const settings: LedgerSettings = JSON.parse(JSON.stringify(before.settings));
      for (const key of ["names", "paymentNames", "links", "learned"] as const)
        settings[key] = Object.assign(Object.create(null), settings[key]);
      await change(db, settings);
      settings.revision++;
      await saveSettings(db, settings);
      // Keep the immutable before snapshot; mutations receive their own copy below.
      const after = await snapshot(db);
      await db.webUndo.deleteMany();
      const undo = await db.webUndo.create(
        {
          data: {
            before: json(before),
            after: json(after)
          }
        });
      return {
        undo: undo.id
      };
    },
    {
      isolationLevel: "Serializable",
      timeout: 30_000
    });
}
export async function setNotFixed(body: Record<string, unknown>) {
  if (typeof body.id !== "string" || typeof body.notFixed !== "boolean" || !Array.isArray(body.ids)
    || !body.ids.every((id) => typeof id === "string")) {
    throw new LedgerError(
      400,
      "Choose a fixed cost and its payments.",
      "Wähle einen Fixkosten-Eintrag und seine Zahlungen.");
  }
  return changeLedger(
    async (db, settings) => {
      const d = await webDashboard(db);
      const entries = Object.values(d.fixedCosts).flatMap((list) => [...list.running, ...list.ended, ...list.takenOut]);
      const live = entries.find((e) => e.id === body.id);
      if (!live || JSON.stringify(live.ids) !== JSON.stringify(body.ids))
        throw changed();
      if (body.notFixed) {
        if (!settings.fixedCostMarks.some((m) => markID(m) === live.id))
          settings.fixedCostMarks.push(live.mark);
      } else
        settings.fixedCostMarks = settings.fixedCostMarks.filter((mark) =>
          markID(mark) !== live.id && !live.exclusionIDs.includes(markID(mark)));
    });
}
export async function undoLedger(body: Record<string, unknown>) {
  if (typeof body.undo !== "string")
    throw changed();
  return prisma.$transaction(
    async (db) => {
      const record = await db.webUndo.findUnique({
        where: {
          id: body.undo as string
        }
      });
      if (!record || digest(await snapshot(db)) !== digest(record.after))
        throw changed();
      const before = record.before as unknown as Awaited<ReturnType<typeof snapshot>>;
      // Restore only changed category memberships; bank amounts, text and external ids are never written.
      const after = record.after as unknown as Awaited<ReturnType<typeof snapshot>>;
      for (const category of before.categories) {
        const current = after.categories.find((c: any) => c.id === category.id);
        if (JSON.stringify(current) !== JSON.stringify(category))
          await db.category.upsert(
            {
              where: {
                id: category.id
              },
              create: category,
              update: category
            });
      }
      const primaryChanges = before.transactions.filter(
        (row: any) => after.transactions.find((p: any) => p.id === row.id)?.categoryId !== row.categoryId);
      if (primaryChanges.length) {
        const originals = await db.transaction.findMany(
          {
            where: {
              id: {
                in: primaryChanges.map((p: any) => p.id)
              }
            },
            select: {
              id: true,
              counterparty: true,
              description: true
            }
          });
        // Keep the audit append-only, while its latest learning signal follows the undo too.
        await db.categoryCorrection.createMany(
          {
            data: primaryChanges.map(
              (row: any) => {
                const current = after.transactions.find((p: any) => p.id === row.id);
                const original = originals.find((p) => p.id === row.id);
                if (!current || !original)
                  throw changed();
                return {
                  transactionId: row.id,
                  merchant: original.counterparty || original.description,
                  fromCategory: after.categories.find((c: any) => c.id === current.categoryId)?.name ?? null,
                  toCategory: before.categories.find((c: any) => c.id === row.categoryId)?.name ?? "Uncategorised",
                  fromSource: current.categorySource
                };
              })
          });
      }
      for (const row of before.transactions) {
        const current = after.transactions.find((p: any) => p.id === row.id);
        if (!current)
          throw changed();
        const fields = (p: any) => [p.categoryId, p.categorySource, p.categorized, p.tags];
        if (JSON.stringify(fields(row)) === JSON.stringify(fields(current)))
          continue;
        await db.transaction.update(
          {
            where: {
              id: row.id
            },
            data: {
              categoryId: row.categoryId,
              categorySource: row.categorySource,
              categorized: row.categorized
            }
          });
        await db.transactionTag.deleteMany({
          where: {
            transactionId: row.id
          }
        });
        if (row.tags.length)
          await db.transactionTag.createMany(
            {
              data: row.tags.map(
                (tag: any) => ({
                  transactionId: row.id,
                  categoryId: tag.categoryId
                }))
            });
      }
      for (const category of after.categories)
        if (!before.categories.some((c: any) => c.id === category.id))
          await db.category.delete({
            where: {
              id: category.id
            }
          });
      if (JSON.stringify(before.rules) !== JSON.stringify(after.rules)) {
        await db.categoryRule.deleteMany();
        if (before.rules.length)
          await db.categoryRule.createMany({
            data: before.rules
          });
      }
      await saveSettings(db, before.settings);
      await db.webUndo.delete({
        where: {
          id: record.id
        }
      });
      return {
        undone: true
      };
    },
    {
      isolationLevel: "Serializable",
      timeout: 30_000
    });
}

// PostgreSQL JSONB reorders object keys. Canonicalize before comparing saved snapshots or preview revisions.
const canonical = (value: unknown) => JSON.stringify(
  value,
  (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
    : v);
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const idsFrom = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.length || value.length > 5000
    || !value.every((v) => typeof v === "string" && v.length > 0)
    || new Set(value).size !== value.length)
    throw new LedgerError(400, "Choose payments.", "Wähle Zahlungen.");
  return value;
};
export async function paybackPreview(body: Record<string, unknown>,
  db?: DB): Promise<Awaited<ReturnType<typeof buildPaybackPreview>>> {
  return db
    ? buildPaybackPreview(body, db)
    : prisma.$transaction((tx) => buildPaybackPreview(body, tx), {
      isolationLevel: "RepeatableRead"
    });
}
async function buildPaybackPreview(body: Record<string, unknown>, db: DB) {
  const dashboard = await webDashboard(db);
  const ids = idsFrom(body.ids);
  try {
    const choices = paybackChoices(dashboard, ids);
    const plan = body.others
      ? planPaybacks(dashboard, ids, idsFrom(body.others), body.amount as number | undefined)
      : null;
    return {
      ...choices,
      plan,
      revision: digest(await snapshot(db))
    };
  } catch {
    throw new LedgerError(
      400,
      "Choose eligible payments and an amount within both remaining amounts.",
      "Wähle passende Zahlungen und einen Betrag innerhalb beider Restbeträge.");
  }
}
export async function savePaybacks(body: Record<string, unknown>) {
  return changeLedger(
    async (db, settings) => {
      if (body.revision !== digest(await snapshot(db)))
        throw changed();
      const { plan } = await paybackPreview(body, db);
      if (!plan?.links.length)
        throw changed();
      settings.links = applyPlan(settings.links, plan);
    });
}
export async function editPayback(body: Record<string, unknown>) {
  if (typeof body.from !== "string" || typeof body.to !== "string" || !centAmount(body.amount)
    || body.amount < 0)
    throw new LedgerError(400, "Type the amount in whole cents.", "Gib den Betrag in ganzen Cent ein.");
  return changeLedger(
    async (db, settings) => {
      const links = settings.links[body.from as string] ?? [];
      const existing = links.find((l) => l.payment === body.to);
      if (!existing)
        throw changed();
      const amount = body.amount as number;
      if (amount > existing.amount) {
        try {
          planPaybacks(
            await webDashboard(db),
            [body.from as string],
            [body.to as string],
            Math.round((amount - existing.amount) * 100) / 100);
        }
        catch {
          throw new LedgerError(400, "The amount exceeds what is left.", "Der Betrag übersteigt den Restbetrag.");
        }
      }
      settings.links[body.from as string] = links.filter((l) => l !== existing);
      if (amount > 0)
        settings.links[body.from as string].push({
          payment: body.to as string,
          amount
        });
    });
}

export async function renamePayments(body: Record<string, unknown>) {
  const ids = idsFrom(body.ids);
  if (typeof body.name !== "string" || !["shop", "payment"].includes(String(body.scope)))
    throw new LedgerError(
      400,
      "Type a name and choose which payments.",
      "Gib einen Namen ein und wähle die Zahlungen.");
  const name = [...new Intl.Segmenter("en", {
    granularity: "grapheme"
  }).segment(body.name.trim())].slice(0, 60).map((p) => p.segment).join("").trim();
  return changeLedger(
    async (db, settings) => {
      const dashboard = await webDashboard(db);
      const wanted = new Set(ids);
      const selected = dashboard.transactions.filter((p) => wanted.has(p.id));
      if (selected.length !== wanted.size
        || (body.revision && body.revision !== digest(await snapshot(db))))
        throw changed();
      if (!selected.some((p) => !p.receiptId && !p.coveredBy))
        throw new LedgerError(400, "Edit the shop on the cash entry.", "Ändere den Namen im Bargeldeintrag.");
      for (const p of selected.filter((p) => !p.receiptId && !p.coveredBy)) {
        if (body.scope === "shop") {
          if (!p.merchant) {
            if (name)
              settings.paymentNames[p.id] = name; else
              delete settings.paymentNames[p.id];
            continue;
          }
          delete settings.paymentNames[p.id];
          // Store under the original engine merchant key, and remove aliases of the same identity.
          const merchant = p.fixedCostKey!.slice("merchant:".length);
          const keys = Object.keys(settings.names);
          const identities = shopIdentities([merchant, ...keys]);
          keys.forEach(
            (key, i) => {
              if (identities[i + 1] === identities[0])
                delete settings.names[key];
            });
          if (name)
            settings.names[merchant] = name;
        } else {
          if (name)
            settings.paymentNames[p.id] = name; else
            delete settings.paymentNames[p.id];
        }
      }
    });
}
export async function setOwnNames(body: Record<string, unknown>) {
  if (typeof body.enabled !== "boolean")
    throw new LedgerError(400, "Choose whether to show own names.", "Wähle, ob eigene Namen angezeigt werden.");
  return changeLedger(async (_db, settings) => {
    settings.ownNames = body.enabled as boolean;
  });
}

export async function previewSelection(body: Record<string, unknown>,
  db?: DB): Promise<Awaited<ReturnType<typeof buildSelectionPreview>>> {
  return db
    ? buildSelectionPreview(body, db)
    : prisma.$transaction((tx) => buildSelectionPreview(body, tx), {
      isolationLevel: "RepeatableRead"
    });
}
async function buildSelectionPreview(body: Record<string, unknown>, db: DB) {
  const dashboard = await webDashboard(db);
  const ids = idsFrom(body.ids);
  let summary: ReturnType<typeof selectionSummary>;
  try {
    summary = selectionSummary(dashboard.transactions, ids, body.category as string | undefined);
  }
  catch {
    throw new LedgerError(400, "Select payments on one side.", "Wähle Zahlungen einer Seite.");
  }
  return {
    ...summary,
    revision: digest(await snapshot(db))
  };
}
function clearTransferLinks(settings: LedgerSettings, ids: Set<string>) {
  for (const payer of Object.keys(settings.links)) {
    if (ids.has(payer))
      delete settings.links[payer];
    else
      settings.links[payer] = settings.links[payer].filter((l) => !ids.has(l.payment));
  }
}
export async function changePayments(body: Record<string, unknown>) {
  const ids = idsFrom(body.ids);
  if (["dropCurrent", "otherPayments"].some((key) => body[key] !== undefined && typeof body[key] !== "boolean")
    || !["switch", "add"].includes(String(body.mode))
    || !Array.isArray(body.categories)
    || !body.categories.every((n) => typeof n === "string")
    || (body.removeCategories !== undefined
      && (!Array.isArray(body.removeCategories)
        || !body.removeCategories.every((n) => typeof n === "string")))
    || (!body.categories.length
      && !(body.mode === "add" && !body.dropCurrent && Array.isArray(body.removeCategories)
        && body.removeCategories.length)))
    throw new LedgerError(400, "Choose a category.", "Wähle eine Kategorie.");
  return changeLedger(
    async (db, settings) => {
      if (body.revision && body.revision !== digest(await snapshot(db)))
        throw changed();
      const categories = await db.category.findMany({
        where: {
          removed: false
        }
      });
      const wantedNames = body.categories as string[];
      const targets = wantedNames.map((name) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase()));
      if (targets.some((c) => !c))
        throw new LedgerError(400, "Category not found.", "Kategorie nicht gefunden.");
      const target = targets[0];
      const dashboard = await webDashboard(db);
      const selectedRow = dashboard.transactions.find((p) => p.id === ids[0]);
      if (!selectedRow)
        throw changed();
      const selectedIncome = selectedRow.amount > 0;
      for (const c of targets) {
        const kind = dashboard.categories.find((m) => m.name === c!.name)?.kind;
        if (!c!.excludeFromTotals && kind !== (selectedIncome ? "income" : "spend"))
          await db.category.update(
            {
              where: {
                id: c!.id
              },
              data: {
                otherSide: true
              }
            });
      }
      if (body.quickKey) {
        const group = dashboard.quickSort.find((g) => g.key === body.quickKey);
        if (!group || JSON.stringify(group.ids.slice().sort()) !== JSON.stringify(ids.slice().sort()))
          throw changed();
      }
      let summary: ReturnType<typeof selectionSummary>;
      try {
        summary = selectionSummary(dashboard.transactions, ids, target?.name);
      }
      catch {
        throw new LedgerError(400, "Select payments on one side.", "Wähle Zahlungen einer Seite.");
      }
      const wanted = new Set(body.otherPayments ? [...ids, ...summary.otherIDs] : ids);
      const rows = await db.transaction.findMany({
        include: {
          tags: true
        }
      });
      if (body.unsortedOnly && rows.some((p) => wanted.has(p.id) && p.categoryId !== null))
        throw changed();
      const cash = settings.cashEntries.filter((p) => wanted.has(p.id));
      if (body.mode === "switch" && target)
        for (const entry of cash)
          entry.category = target.name;
      const chosen = rows.filter((p) => wanted.has(p.id));
      const switchPrimary = body.mode === "switch" || body.dropCurrent === true;
      const removedIDs = new Set(
        (body.removeCategories as string[] | undefined ?? []).map(
          (name) => categories.find((category) =>
            category.name.toLowerCase() === name.toLowerCase())?.id).filter(Boolean));
      const moved = new Set(switchPrimary ? chosen.map((p) => p.id) : []);
      if (switchPrimary) {
        if (!target)
          throw new LedgerError(400, "Choose a category.", "Wähle eine Kategorie.");
        await db.transaction.updateMany(
          {
            where: {
              id: {
                in: [...wanted]
              }
            },
            data: {
              categoryId: target.id,
              categorized: true,
              categorySource: "manual"
            }
          });
        const corrections = chosen.filter((p) => p.categoryId !== target.id).map(
          (p) => ({
            transactionId: p.id,
            merchant: p.counterparty || p.description,
            fromCategory: categories.find((c) => c.id === p.categoryId)?.name ?? null,
            toCategory: target.name,
            fromSource: p.categorySource
          }));
        if (corrections.length)
          await db.categoryCorrection.createMany({
            data: corrections
          });
      }
      if (body.mode === "switch" && target) {
        const keys = chosen.map(
          (row) => merchantKey(
            {
              counterparty: row.counterparty,
              description: row.description,
              amount: Number(row.amount)
            }));
        const stored = Object.keys(settings.learned);
        const identities = shopIdentities([...keys, ...stored]);
        for (const [i, row] of chosen.entries()) {
          const merchant = keys[i];
          const side = Number(row.amount) > 0 ? "income" : "spend";
          if (!merchant)
            continue;
          stored.forEach(
            (key, j) => {
              if (identities[keys.length + j] === identities[i])
                settings.learned[key][side] = target.id;
            });
          if (!Object.hasOwn(settings.learned, merchant))
            Object.defineProperty(
              settings.learned,
              merchant,
              {
                value: {},
                enumerable: true,
                configurable: true,
                writable: true
              });
          settings.learned[merchant][side] = target.id;
        }
      }
      if (body.mode === "add") {
        const tags = chosen.flatMap(
          (row) => {
            const primary = switchPrimary ? target!.id : row.categoryId;
            const existing = row.tags.map((tag) => tag.categoryId).filter((id) => !removedIDs.has(id));
            const additions = targets.slice(body.dropCurrent ? 1 : 0).map((c) => c!.id);
            return [...new Set([...existing, ...additions])].filter((id) => id !== primary).map(
              (id) => ({
                transactionId: row.id,
                categoryId: id
              }));
          });
        await db.transactionTag.deleteMany(
          {
            where: {
              transactionId: {
                in: [...wanted]
              }
            }
          });
        if (tags.length)
          await db.transactionTag.createMany({
            data: tags
          });
      }
      if (target?.excludeFromTotals)
        clearTransferLinks(settings, moved);
    });
}
/** Only the new import's rows are touched. Manual choices are applied on original bank identities. */
export async function applyRememberedForImports(newIDs: string[]) {
  if (!newIDs.length)
    return;
  await prisma.$transaction(
    async (db) => {
      const settings = await readSettings(db);
      const rows = await db.transaction.findMany(
        {
          where: {
            id: {
              in: newIDs
            }
          },
          include: {
            category: true
          }
        });
      const keys = rows.map(
        (p) => merchantKey(
          {
            counterparty: p.counterparty,
            description: p.description,
            amount: Number(p.amount)
          }));
      const learnedKeys = Object.keys(settings.learned);
      const identities = shopIdentities([...keys, ...learnedKeys]);
      const categories = await db.category.findMany({
        where: {
          removed: false
        }
      });
      const known = new Set(categories.map((c) => c.id));
      for (const [i, row] of rows.entries()) {
        if (row.category?.removed) {
          await resortRows(db, settings, [row.id]);
          continue;
        }
        if (row.categorySource === "manual" || row.category?.excludeFromTotals)
          continue;
        const side = Number(row.amount) > 0 ? "income" : "spend";
        const key = Object.hasOwn(settings.learned, keys[i])
          ? keys[i]
          : learnedKeys.find((_key, j) => identities[keys.length + j] === identities[i]);
        const target = key ? settings.learned[key]?.[side] : undefined;
        if (target && known.has(target))
          await db.transaction.update(
            {
              where: {
                id: row.id
              },
              data: {
                categoryId: target,
                categorized: true,
                categorySource: "rule"
              }
            });
      }
    },
    {
      isolationLevel: "Serializable",
      timeout: 30_000
    });
}

export async function sortUnsortedGroup(body: Record<string, unknown>) {
  if (typeof body.key !== "string" || typeof body.category !== "string")
    throw new LedgerError(400, "Choose a name and category.", "Wähle einen Namen und eine Kategorie.");
  return changePayments(
    {
      ids: body.ids,
      mode: "switch",
      categories: [body.category],
      unsortedOnly: true,
      quickKey: body.key
    });
}

const foldName = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(
  /ß/g, "ss").trim();
const LEGACY_DEFAULTS: Record<string, string> = {
  Restaurants: "eating-out",
  Drogerie: "drugstore",
  Tech: "electronics",
  Fitness: "sports-fitness",
  Drinking: "going-out",
  "Non-essentials": "shopping",
  Tax: "taxes",
  Income: "salary",
  Basis: "parents-family"
};
function defaultCategory(name: string) {
  return DEFAULT_CATEGORIES.find(
    (c) => c.id === LEGACY_DEFAULTS[name]
      || Object.values(c.name).some((n) => foldName(n) === foldName(name)));
}
const protectedCategory = (name: string) => [
  "Uncategorised",
  "Not sorted",
  "Nicht sortiert",
  "Transfer",
  "Own transfers",
  "Eigene Umbuchungen"
].some((n) => foldName(n) === foldName(name));
const checkedName = (value: unknown) => {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 60
    || ["Cash", "Bargeld"].some((n) => foldName(n) === foldName(value))
    || protectedCategory(value))
    throw new LedgerError(
      400,
      "Choose a name of up to 60 characters that is not reserved.",
      "Wähle einen nicht reservierten Namen mit höchstens 60 Zeichen.");
  return value.trim();
};
async function resortRows(db: DB, settings: LedgerSettings, ids: string[]) {
  const rows = await db.transaction.findMany({
    include: {
      category: true
    }
  });
  const categories = await db.category.findMany({
    where: {
      removed: false
    }
  });
  const catalog = categories.map(
    (c) => ({
      db: c,
      engine: defaultCategory(c.originalName || c.name)?.id ?? (c.excludeFromTotals ? "own-transfers" : c.id)
    }));
  const learnedKeys = Object.keys(settings.learned);
  for (const side of ["spend", "income"] as const) {
    const learned = Object.fromEntries(
      learnedKeys.flatMap(
        (key) => {
          const id = settings.learned[key][side];
          const c = catalog.find((c) => c.db.id === id);
          return c ? [[key, c.engine]] : [];
        }));
    const sorted = sortPayments(
      rows.map(
        (p) => ({
          counterparty: p.counterparty,
          description: p.description,
          amount: Number(p.amount),
          date: p.bookingDate.toISOString().slice(0, 10),
          currency: p.currency,
          account: p.accountId
        })),
      {
        categories: catalog.map((c) => ({
          id: c.engine
        })),
        learned
      });
    for (const [i, p] of rows.entries()) {
      if (!ids.includes(p.id) || (Number(p.amount) > 0 ? "income" : "spend") !== side)
        continue;
      const result = sorted[i];
      const target = catalog.find((c) => c.engine === result.categoryId)?.db;
      await db.transaction.update(
        {
          where: {
            id: p.id
          },
          data: {
            categoryId: target?.id ?? null,
            categorized: !!target,
            categorySource: target ? "rule" : null
          }
        });
    }
  }
}
export async function editCategory(body: Record<string, unknown>) {
  if (!["create", "rename", "delete", "restore", "side"].includes(String(body.action)))
    throw new LedgerError(400, "Choose a category action.", "Wähle eine Kategorie-Aktion.");
  let selected: {
    id: string;
    name: string
  } | undefined;
  const result = await changeLedger(
    async (db, settings) => {
      const categories = await db.category.findMany();
      const action = body.action;
      if (action === "create") {
        const name = checkedName(body.name);
        const side = body.side;
        if (side !== "spend" && side !== "income")
          throw new LedgerError(400, "Choose expenses or income.", "Wähle Ausgaben oder Einnahmen.");
        const matchedDefault = defaultCategory(name);
        const existing = categories.find(
          (c) => foldName(c.name) === foldName(name)
            || (matchedDefault && defaultCategory(c.originalName || c.name)?.id === matchedDefault.id));
        if (existing) {
          const dashboard = await webDashboard(db);
          const kind = dashboard.categories.find((c) => c.name === existing.name)?.kind;
          selected = await db.category.update(
            {
              where: {
                id: existing.id
              },
              data: {
                removed: false,
                ...(kind !== side && !existing.excludeFromTotals
                  ? {
                    otherSide: true
                  }
                  : {})
              }
            });
        } else {
          const used = new Set(categories.map((c) => c.icon));
          const choices = [
            "Heart",
            "Palette",
            "Music",
            "BookOpen",
            "Coffee",
            "Ticket",
            "Gift",
            "Bike",
            "Wrench",
            "Flower2"
          ];
          const look = matchedDefault
            ? categoryLook(matchedDefault.id)
            : {
              icon: choices.find((icon) => !used.has(icon)) || choices[categories.length % choices.length],
              color: ["#5B8CFF", "#FF7A33", "#A36BFF", "#26E07A", "#FF5CC8"][categories.length % 5]
            };
          selected = await db.category.create(
            {
              data: {
                name: matchedDefault?.name.en ?? name,
                side: matchedDefault ? matchedDefault.kind === "transfer" ? null : matchedDefault.kind : side,
                excludeFromTotals: matchedDefault?.kind === "transfer",
                ...look,
                originalName: matchedDefault?.name.en ?? null,
                otherSide: matchedDefault?.id === "friends"
                  || (!!matchedDefault && matchedDefault.kind !== side && matchedDefault.kind !== "transfer")
              }
            });
        }
        return;
      }
      const category = categories.find((c) => c.id === body.id);
      if (!category)
        throw new LedgerError(404, "Category not found.", "Kategorie nicht gefunden.");
      if (protectedCategory(category.originalName || category.name))
        throw new LedgerError(400, "This category cannot be changed.", "Diese Kategorie kann nicht geändert werden.");
      if (action === "rename") {
        const name = body.original === true && category.originalName
          ? category.originalName
          : checkedName(body.name);
        if (categories.some(
          (c) => c.id !== category.id
            && (foldName(c.name) === foldName(name)
              || (defaultCategory(name)
                && defaultCategory(c.originalName || c.name)?.id === defaultCategory(name)?.id))))
          throw new LedgerError(
            400,
            "There is already a category with this name.",
            "Es gibt schon eine Kategorie mit diesem Namen.");
        for (const entry of settings.cashEntries)
          if (entry.category === category.name)
            entry.category = name;
        const shown = (await webDashboard(db)).categories.find((c) => c.name === category.name);
        selected = await db.category.update(
          {
            where: {
              id: category.id
            },
            data: {
              name,
              originalName: category.originalName ?? (defaultCategory(category.name) ? category.name : null),
              icon: /^[A-Za-z][A-Za-z0-9]*$/.test(category.icon || "") ? category.icon : shown?.icon,
              color: shown?.color || category.color
            }
          });
      } else
        if (action === "side") {
          if (body.side !== undefined && body.side !== "spend" && body.side !== "income")
            throw new LedgerError(400, "Choose expenses or income.", "Wähle Ausgaben oder Einnahmen.");
          if (body.otherSide !== undefined && typeof body.otherSide !== "boolean")
            throw new LedgerError(
              400,
              "Choose whether to offer this category on both sides.",
              "Wähle, ob diese Kategorie auf beiden Seiten angeboten wird.");
          const rows = await db.transaction.findMany({
            where: {
              categoryId: category.id
            }
          });
          const keepOther = body.side
            && rows.some(
              (p) => p.categoryId === category.id && (Number(p.amount) > 0 ? "income" : "spend") !== body.side);
          selected = await db.category.update(
            {
              where: {
                id: category.id
              },
              data: {
                ...(body.side ? {
                  side: body.side as string
                } : {}),
                otherSide: body.otherSide as boolean | undefined ?? (keepOther ? true : category.otherSide)
              }
            });
        } else
          if (action === "restore") {
            selected = await db.category.update(
              {
                where: {
                  id: category.id
                },
                data: {
                  removed: false
                }
              });
            const waiting = await db.transaction.findMany({
              where: {
                categoryId: null
              }
            });
            await resortRows(db, settings, waiting.filter((p) => !p.categoryId).map((p) => p.id));
          } else {
            for (const entry of settings.cashEntries)
              if (entry.category === category.name)
                entry.category = null;
            const rows = await db.transaction.findMany({
              include: {
                tags: true
              }
            });
            const affected = rows.filter((p) => p.categoryId === category.id).map((p) => p.id);
            for (const p of rows) {
              if (p.categoryId === category.id)
                await db.transaction.update(
                  {
                    where: {
                      id: p.id
                    },
                    data: {
                      categoryId: null,
                      categorized: false,
                      categorySource: null
                    }
                  });
              await db.transactionTag.deleteMany(
                {
                  where: {
                    transactionId: p.id,
                    categoryId: category.id
                  }
                });
            }
            if (defaultCategory(category.originalName || category.name))
              await db.category.update(
                {
                  where: {
                    id: category.id
                  },
                  data: {
                    removed: true
                  }
                });
            else {
              for (const key of Object.keys(settings.learned))
                for (const side of ["spend", "income"] as const)
                  if (settings.learned[key][side] === category.id)
                    delete settings.learned[key][side];
              await db.category.delete(
                {
                  where: {
                    id: category.id
                  }
                });
            }
            await resortRows(db, settings, affected);
            const after = await webDashboard(db);
            const transfers = new Set(
              after.transactions.filter((p) => !p.categoriesIn.length && !p.incomeBuckets.length).map((p) => p.id));
            clearTransferLinks(settings, transfers);
          }
    });
  return {
    ...result,
    category: selected
  };
}

export async function changeTransactionTags(id: string, categoryNames: string[], dropCurrent: boolean) {
  return changeLedger(
    async (db, settings) => {
      const row = await db.transaction.findUnique({
        where: {
          id
        }
      });
      if (!row)
        throw changed();
      const categories = await db.category.findMany({
        where: {
          removed: false
        }
      });
      const wanted = [
        ...new Set(
          categoryNames.map(
            (name) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
 ?.id).filter((id): id is string => !!id))
      ];
      if (dropCurrent && !wanted.length)
        throw new LedgerError(400, "Choose at least one category.", "Wähle mindestens eine Kategorie.");
      const primary = dropCurrent ? wanted[0] : row.categoryId;
      if (dropCurrent) {
        await db.transaction.update(
          {
            where: {
              id
            },
            data: {
              categoryId: primary,
              categorized: true,
              categorySource: "manual"
            }
          });
        if (categories.find((c) => c.id === primary)?.excludeFromTotals)
          clearTransferLinks(settings, new Set([id]));
      }
      await db.transactionTag.deleteMany({
        where: {
          transactionId: id
        }
      });
      const tags = wanted.filter((categoryId) => categoryId !== primary);
      if (tags.length)
        await db.transactionTag.createMany(
          {
            data: tags.map(
              (categoryId) => ({
                transactionId: id,
                categoryId
              }))
          });
    });
}

export async function editCash(body: Record<string, unknown>) {
  if (!["create", "edit", "delete"].includes(String(body.action)))
    throw new LedgerError(400, "Choose a cash entry action.", "Wähle eine Bargeld-Aktion.");
  return changeLedger(
    async (db, settings) => {
      const existing = settings.cashEntries.find((p) => p.id === body.id);
      if (body.action !== "create" && !existing)
        throw changed();
      if (body.action === "delete") {
        settings.cashEntries = settings.cashEntries.filter((p) => p.id !== body.id);
        return;
      }
      if (typeof body.date !== "string" || body.date.length !== 10 || !parseDay(body.date)
        || typeof body.shop !== "string"
        || !body.shop.trim()
        || !centAmount(body.total)
        || body.total <= 0
        || !["out", "in"].includes(String(body.direction)))
        throw new LedgerError(
          400,
          "Enter a name, date and positive amount in whole cents.",
          "Gib einen Namen, ein Datum und einen positiven Betrag in ganzen Cent ein.");
      const category = body.category
        ? (await db.category.findMany({
          where: {
            removed: false
          }
        })).find((c) => c.name === body.category)
        : null;
      if (body.category && (!category || category.excludeFromTotals))
        throw new LedgerError(400, "Choose a cash category.", "Wähle eine Bargeld-Kategorie.");
      const entry = {
        id: existing?.id ?? "cash-" + randomUUID(),
        date: body.date,
        shop: body.shop.trim().slice(0, 60),
        total: body.total,
        direction: body.direction as "in" | "out",
        currency: "EUR",
        method: "cash" as const,
        kind: "manual" as const,
        category: category?.name ?? null,
        paymentId: null,
        paidFrom: typeof body.paidFrom === "string" && body.paidFrom ? body.paidFrom : null
      };
      settings.cashEntries = [...settings.cashEntries.filter((p) => p.id !== entry.id), entry];
    });
}
