import {
  normaliseLabel,
  type Deadline,
} from "@/domain/deadline";
import {
  BUDGET_SEED_VERSION,
  type BudgetCategory,
  type Transaction,
} from "@/domain/money";
import { StatementBatch } from "@/domain/statementBatch";
import {
  Instant,
  LocalDate,
  Occurrence,
  Reminder,
  Settings,
  Task,
} from "@/domain/types";
import {
  normaliseLink,
  type WishlistItem,
} from "@/domain/wishlist";
import {
  DB_VERSION,
  DEFAULT_SETTINGS,
  emptyDatabase,
  pruneTombstones,
  type Database,
} from "./db";
import {
  backfillBudgetCategories,
  backfillCategories,
  CATEGORY_SEED_VERSION,
  defaultBudgetCategories,
  deduplicateBudgetCategories,
  deduplicateCategories,
} from "./categorySeed";

/**
 * The bank-mail feed is gone, and so is its configuration.
 *
 * Stripped rather than ignored: the block held a mailbox host and username, and
 * a document that keeps carrying them writes them into every backup the user
 * ever makes, for a feature that no longer exists to read them.
 */
function settingsOf(doc: Partial<Database>): Settings {
  const { mailSync: _removedMailSync, ...stored } = (doc.settings ?? {}) as Record<
    string,
    unknown
  >;
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

/** Categories and their tasks, with any seed round this document never saw. */
function migrateCategories(doc: Partial<Database>, tasks: Task[], language: "tr" | "en") {
  const stored =
    Array.isArray(doc.categories) && doc.categories.length > 0
      ? doc.categories
      : emptyDatabase().categories;
  // A document written before a seed round existed is offered it now, once.
  const withSeeds = backfillCategories(
    stored,
    doc.settings?.categorySeedVersion ?? 0,
    language,
  );
  return deduplicateCategories(withSeeds, tasks, language);
}

/** The ledger and its categories, likewise offered any round they never saw. */
function migrateBudget(doc: Partial<Database>, language: "tr" | "en") {
  const base = emptyDatabase();
  const transactions = Array.isArray(doc.transactions)
    ? doc.transactions.map(normaliseTransaction)
    : base.transactions;
  const stored = Array.isArray(doc.budgetCategories)
    ? doc.budgetCategories.map(normaliseBudgetCategory)
    : defaultBudgetCategories(language);
  const withSeeds = backfillBudgetCategories(
    stored,
    doc.settings?.budgetCategorySeedVersion ?? 0,
    language,
  );
  return deduplicateBudgetCategories(withSeeds, transactions, language);
}

/**
 * Imports that happened before imports were recorded.
 *
 * The batch record is what "geri al" hangs off, and a document written before it
 * existed has none — so the one import someone most wants back, the one they
 * made by mistake last week, is the one the list cannot offer. Every row a
 * statement wrote carries the instant of the import that wrote it, and one
 * import writes them all at the same instant, so the groups are exact.
 */
function migrateBatches(doc: Partial<Database>, transactions: Transaction[]) {
  return recoverStatementBatches(
    transactions,
    Array.isArray(doc.statementBatches)
      ? doc.statementBatches.map(normaliseStatementBatch)
      : emptyDatabase().statementBatches,
  );
}

export function migrate(raw: unknown): Database {
  const base = emptyDatabase();
  if (!raw || typeof raw !== "object") return base;
  const doc = raw as Partial<Database>;

  const settings = settingsOf(doc);
  const language = settings.language ?? "tr";
  const tasks = Array.isArray(doc.tasks) ? doc.tasks.map(normaliseTask) : base.tasks;

  const categories = migrateCategories(doc, tasks, language);
  const budget = migrateBudget(doc, language);
  const batches = migrateBatches(doc, budget.transactions);

  return {
    version: DB_VERSION,
    tasks: categories.tasks,
    categories: categories.categories,
    occurrences: Array.isArray(doc.occurrences)
      ? doc.occurrences.filter(isAddressableOccurrence).map(normaliseOccurrence)
      : base.occurrences,
    reminders: Array.isArray(doc.reminders)
      ? doc.reminders.filter(isAddressableReminder).map(normaliseReminder)
      : base.reminders,
    history: Array.isArray(doc.history) ? doc.history : base.history,
    focusSessions: Array.isArray(doc.focusSessions)
      ? doc.focusSessions
      : base.focusSessions,
    tombstones: Array.isArray(doc.tombstones)
      ? pruneTombstones(doc.tombstones)
      : base.tombstones,
    transactions: batches.transactions,
    budgetCategories: budget.budgetCategories,
    wishlist: Array.isArray(doc.wishlist)
      ? doc.wishlist.map(normaliseWishlistItem)
      : base.wishlist,
    // A checkpoint with no name or no day cannot be drawn or read, and one
    // pointing at no task belongs to nothing — all three are dropped rather than
    // carried as rows nothing can ever show.
    deadlines: Array.isArray(doc.deadlines)
      ? doc.deadlines.map(normaliseDeadline).filter(isUsableDeadline)
      : base.deadlines,
    statementBatches: batches.batches,
    settings: {
      ...settings,
      categorySeedVersion: CATEGORY_SEED_VERSION,
      budgetCategorySeedVersion: BUDGET_SEED_VERSION,
    },
  };
}

/**
 * Documents written before occurrences carried a timestamp get one now.
 *
 * The epoch is deliberate: a row with no recorded edit time must lose every
 * conflict against a row that has one, rather than win by accident.
 */
const EPOCH = new Date(0).toISOString();

/**
 * Drop occurrence and reminder rows that name no task.
 *
 * Both are per-task state, addressed as `${taskId}::${date}` and by `taskId`
 * respectively, so a row without one is already invisible to every reader —
 * it cannot be shown, completed, or fired. What it *can* still do is travel:
 * `task_id` is NOT NULL in the cloud, so the row is rejected on every push and
 * takes the whole reconciliation down with it. Discarding it on load loses
 * nothing a user could reach and un-wedges sync on the next pass.
 */
function isAddressableOccurrence(occurrence: Occurrence): boolean {
  return Boolean(occurrence?.taskId) && Boolean(occurrence?.date);
}

function isAddressableReminder(reminder: Reminder): boolean {
  return Boolean(reminder?.taskId);
}

function normaliseOccurrence(occurrence: Occurrence): Occurrence {
  return { ...occurrence, updatedAt: occurrence.updatedAt ?? EPOCH };
}

function normaliseReminder(reminder: Reminder): Reminder {
  return {
    ...reminder,
    updatedAt: reminder.updatedAt ?? reminder.createdAt ?? EPOCH,
  };
}

/**
 * Give the entries of a past import a batch to belong to.
 *
 * Runs once: the pass stamps every row it groups with an `importId`, and a
 * stamped row is no longer looking for a home. Deleted rows are left out of
 * both the group and its totals — an import whose entries were half thrown away
 * by hand should say what it still holds, and reverting must not put back what
 * someone deliberately removed.
 *
 * `settled` comes back empty, and that is the one thing a recovered batch
 * cannot know: the rows this import *stamped* rather than created are
 * indistinguishable now from rows stamped by any other. Undoing one of these
 * takes away what it added, which is the mistake worth undoing.
 */
/** A live row a statement wrote, which no batch record has claimed. */
function wroteByStatement(entry: Transaction): boolean {
  return (
    entry.deletedAt === null &&
    !entry.importId &&
    typeof entry.externalId === "string" &&
    entry.externalId.startsWith("stmt")
  );
}

function recoverStatementBatches(
  transactions: Transaction[],
  existing: StatementBatch[],
): { transactions: Transaction[]; batches: StatementBatch[] } {
  const groups = new Map<Instant, Transaction[]>();
  for (const entry of transactions) {
    if (!wroteByStatement(entry)) continue;
    const bucket = groups.get(entry.createdAt);
    if (bucket) bucket.push(entry);
    else groups.set(entry.createdAt, [entry]);
  }
  if (groups.size === 0) return { transactions, batches: existing };

  const idByEntry = new Map<string, string>();
  const recovered: StatementBatch[] = [];

  for (const [importedAt, rows] of groups) {
    const id = `imp_recovered_${importedAt.replace(/[^0-9]/g, "")}`;
    const dates = rows.map((row) => row.date).sort();
    // Only when every row agrees; a mixed group is two cards in one file, and
    // naming one of them would be a guess presented as a fact.
    const accounts = new Set(rows.map((row) => row.account ?? ""));
    for (const row of rows) idByEntry.set(row.id, id);

    recovered.push({
      id,
      // The day it was loaded, because the file it came from is not recoverable
      // and the period it covers is already the line underneath. It also
      // answers the question a recovered row otherwise cannot: when was this.
      label: importedAt.slice(0, 10),
      account: accounts.size === 1 ? ([...accounts][0] || null) : null,
      importedAt,
      from: dates[0] as LocalDate,
      to: dates[dates.length - 1] as LocalDate,
      mode: rows.every((row) => row.externalId?.startsWith("stmt-daily:"))
        ? "daily"
        : "rows",
      createdCount: rows.length,
      createdMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
      settled: [],
      revertedAt: null,
      deletedAt: null,
    });
  }

  return {
    transactions: transactions.map((entry) => {
      const id = idByEntry.get(entry.id);
      return id ? { ...entry, importId: id } : entry;
    }),
    batches: [...existing, ...recovered].sort((a, b) =>
      a.importedAt.localeCompare(b.importedAt),
    ),
  };
}

function normaliseStatementBatch(batch: StatementBatch): StatementBatch {
  const at = batch.importedAt ?? EPOCH;
  return {
    ...batch,
    label: (batch.label ?? "").trim(),
    account: batch.account ?? null,
    mode: batch.mode === "daily" ? "daily" : "rows",
    createdCount: Math.max(0, Math.trunc(Number(batch.createdCount) || 0)),
    createdMinor: Math.round(Number(batch.createdMinor) || 0),
    settled: Array.isArray(batch.settled) ? batch.settled : [],
    importedAt: at,
    revertedAt: batch.revertedAt ?? null,
    deletedAt: batch.deletedAt ?? null,
  };
}

function normaliseTransaction(t: Transaction): Transaction {
  // A row carrying `instalmentIndex` is one monthly charge of a purchase, not
  // a purchase: aggregation makes those and nothing may ever write one back.
  const { instalmentIndex: _derived, ...stored } = t;
  return {
    ...stored,
    instalments:
      typeof t.instalments === "number" && t.instalments > 1
        ? Math.trunc(t.instalments)
        : null,
    amountMinor: Math.round(Number(t.amountMinor) || 0),
    note: t.note ?? "",
    flow: t.flow ?? "EXPENSE",
    categoryId: t.categoryId ?? null,
    recurrence: t.recurrence ?? null,
    recurrenceSourceId: t.recurrenceSourceId ?? null,
    lastGeneratedFor: t.lastGeneratedFor ?? null,
    importId: t.importId ?? null,
    deletedAt: t.deletedAt ?? null,
    updatedAt: t.updatedAt ?? t.createdAt ?? EPOCH,
  };
}

function normaliseWishlistItem(item: WishlistItem): WishlistItem {
  return {
    ...item,
    title: (item.title ?? "").trim(),
    // A price of 0 is a price; "not priced yet" is null, and the two have to
    // stay apart or the total silently counts an unknown as free.
    priceMinor:
      typeof item.priceMinor === "number" && Number.isFinite(item.priceMinor)
        ? Math.round(item.priceMinor)
        : null,
    // Re-checked on the way in rather than trusted: the document is a file on
    // disk, and a link is about to become an href. See `normaliseLink`.
    url: typeof item.url === "string" ? normaliseLink(item.url) : null,
    note: item.note ?? "",
    categoryId: item.categoryId ?? null,
    order: typeof item.order === "number" ? item.order : 0,
    boughtAt: item.boughtAt ?? null,
    transactionId: item.transactionId ?? null,
    updatedAt: item.updatedAt ?? item.createdAt ?? EPOCH,
    deletedAt: item.deletedAt ?? null,
  };
}

function normaliseBudgetCategory(c: BudgetCategory): BudgetCategory {
  return {
    ...c,
    name: (c.name ?? "").trim(),
    flow: c.flow ?? "EXPENSE",
    icon: c.icon ?? "•",
    builtIn: Boolean(c.builtIn),
    order: typeof c.order === "number" ? c.order : 0,
    monthlyLimitMinor:
      typeof c.monthlyLimitMinor === "number" ? c.monthlyLimitMinor : null,
    updatedAt: c.updatedAt ?? EPOCH,
  };
}

function normaliseDeadline(deadline: Deadline): Deadline {
  const at = deadline.createdAt ?? new Date().toISOString();
  return {
    ...deadline,
    label: normaliseLabel(String(deadline.label ?? "")) ?? "",
    order: typeof deadline.order === "number" ? deadline.order : 0,
    completedAt: deadline.completedAt ?? null,
    createdAt: at,
    updatedAt: deadline.updatedAt ?? at,
    deletedAt: deadline.deletedAt ?? null,
  };
}

function isUsableDeadline(deadline: Deadline): boolean {
  return Boolean(deadline.id && deadline.taskId && deadline.label && deadline.date);
}

/* eslint-disable-next-line complexity -- a flat defaulting map, not branching */
function normaliseTask(task: Task): Task {
  return {
    ...task,
    description: task.description ?? "",
    tags: Array.isArray(task.tags) ? task.tags : [],
    priority: task.priority ?? "NONE",
    status: task.status ?? "TODO",
    allDay: task.allDay ?? true,
    order: typeof task.order === "number" ? task.order : 0,
    manualOrder: typeof task.manualOrder === "number" ? task.manualOrder : null,
    parentId: task.parentId ?? null,
    categoryId: task.categoryId ?? null,
    recurrence: task.recurrence ?? null,
    deadline: task.deadline ?? null,
    estimateMinutes:
      typeof task.estimateMinutes === "number" ? task.estimateMinutes : null,
    snoozedUntil: task.snoozedUntil ?? null,
    completedAt: task.completedAt ?? null,
    deletedAt: task.deletedAt ?? null,
  };
}
