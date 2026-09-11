import { pruneTombstones, tombstone } from "@/data/db";
import { nowInstant } from "@/domain/datetime";
import { createId } from "@/domain/ids";
import {
  BUDGET_CATEGORY_COLORS,
  CATEGORY_CATALOGUE,
  dueRecurringTransactions,
  type BudgetCategory,
  type Transaction,
} from "@/domain/money";
import {
  isLive as batchIsLive,
  restorePatch,
  snapshotOf,
  type StatementBatch,
} from "@/domain/statementBatch";
import type { ImportDraft } from "@/domain/statementImport";
import type { Instant, LocalDate } from "@/domain/types";
import type { BatchInfo } from "../storeTypes";
import { useUndoStore } from "../undoStore";
import type { SliceTools, StoreState } from "../storeState";

// The ledger: transactions, their budget categories, and the statement imports
// that create them in bulk.
export type MoneySlice = Pick<
  StoreState,
  | "addTransaction"
  | "updateTransaction"
  | "deleteTransaction"
  | "restoreTransaction"
  | "ensureBudgetCategory"
  | "updateBudgetCategory"
  | "removeBudgetCategory"
  | "ensureCategoriesForKeys"
  | "importTransactions"
  | "revertImport"
  | "markSpendNudged"
  | "materialiseRecurringTransactions"
>;

function importedTransaction(
  draft: ImportDraft,
  batchId: string,
  at: Instant,
): Transaction {
  return {
    id: createId("x"),
    date: draft.date,
    amountMinor: draft.amountMinor,
    flow: draft.flow,
    categoryId: draft.categoryId,
    note: draft.note,
    merchant: draft.merchant,
    externalId: draft.externalId,
    importId: batchId,
    recurrence: null,
    recurrenceSourceId: null,
    lastGeneratedFor: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

/**
 * The import itself, written down.
 *
 * The undo toast is seconds long, and importing the same file twice is a
 * mistake nobody notices in seconds — it shows up when the month's total is
 * read the next day. The batch is what makes "geri al" still available then,
 * and it carries the settled rows' previous shape for the same reason.
 */
/* eslint-disable-next-line complexity -- defaults for absent fields, not branching */
function importBatch(input: {
  batchId: string;
  batchInfo: BatchInfo | undefined;
  at: Instant;
  created: Transaction[];
  before: Transaction[];
}): StatementBatch {
  const { batchId, batchInfo, at, created, before } = input;
  const dates = [...created, ...before].map((entry) => entry.date).sort();
  return {
    id: batchId,
    label: batchInfo?.label?.trim() || "Ekstre",
    account: batchInfo?.account ?? null,
    importedAt: at,
    from: batchInfo?.from ?? dates[0] ?? at.slice(0, 10),
    to: batchInfo?.to ?? dates[dates.length - 1] ?? at.slice(0, 10),
    mode: batchInfo?.mode ?? "rows",
    createdCount: created.length,
    createdMinor: created.reduce((sum, entry) => sum + entry.amountMinor, 0),
    settled: before.map(snapshotOf),
    revertedAt: null,
    deletedAt: null,
  };
}

export function createMoneySlice({ get, commit }: SliceTools): MoneySlice {
  return {
    addTransaction(draft) {
      const at = nowInstant();
      const transaction: Transaction = {
        id: createId("x"),
        date: draft.date,
        // The sign lives in `flow`, never in the number: a negative "expense"
        // would quietly become income in every total.
        amountMinor: Math.abs(Math.round(draft.amountMinor)),
        flow: draft.flow,
        categoryId: draft.categoryId,
        note: draft.note?.trim() ?? "",
        recurrence: draft.recurrence ?? null,
        recurrenceSourceId: null,
        lastGeneratedFor: null,
        account: draft.account?.trim() || null,
        merchant: draft.merchant?.trim() || null,
        origin: draft.origin ?? "manual",
        externalId: draft.externalId ?? null,
        // One charge is not a plan: anything under two months is stored as the
        // ordinary purchase it is, so no view has to special-case "1/1".
        instalments:
          draft.instalments && draft.instalments > 1
            ? Math.trunc(draft.instalments)
            : null,
        // Nothing typed or pushed is confirmed. Only a statement can say what
        // a purchase finally cost.
        confirmedAt: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      commit((db) => ({
        ...db,
        transactions: [...db.transactions, transaction],
      }));
      return transaction;
    },
    updateTransaction(id, patch) {
      commit((db) => ({
        ...db,
        transactions: db.transactions.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                amountMinor:
                  patch.amountMinor === undefined
                    ? t.amountMinor
                    : Math.abs(Math.round(patch.amountMinor)),
                updatedAt: nowInstant(),
              }
            : t,
        ),
      }));
    },
    /**
     * Soft delete, like a task.
     *
     * A month's totals are a record of what happened. Erasing a row outright
     * would silently rewrite last month's number with no way to notice.
     */
    deleteTransaction(id) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        transactions: db.transactions.map((t) =>
          t.id === id ? { ...t, deletedAt: at, updatedAt: at } : t,
        ),
      }));
      useUndoStore
        .getState()
        .push("undoneTransactionDeleted", () => get().restoreTransaction(id));
    },
    restoreTransaction(id) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        transactions: db.transactions.map((t) =>
          t.id === id ? { ...t, deletedAt: null, updatedAt: at } : t,
        ),
      }));
    },
    /**
     * The "enum that grows".
     *
     * A category the user types is looked up by name first, so typing "Kahve"
     * twice files both entries under one label instead of creating a second
     * identical row. What they type once becomes a permanent choice for them.
     */
    ensureBudgetCategory(name, flow) {
      const trimmed = name.trim();
      const existing = trimmed
        ? get().db.budgetCategories.find(
            (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
          )
        : null;
      if (existing) return existing;

      const all = get().db.budgetCategories;
      const category: BudgetCategory = {
        id: createId("b"),
        name: trimmed || "Diğer",
        flow,
        color:
          BUDGET_CATEGORY_COLORS[all.length % BUDGET_CATEGORY_COLORS.length] ??
          "#64748b",
        icon: flow === "INCOME" ? "💰" : flow === "INVESTMENT" ? "📈" : "🏷️",
        builtIn: false,
        order: all.length,
        updatedAt: nowInstant(),
      };
      commit((db) => ({
        ...db,
        budgetCategories: [...db.budgetCategories, category],
      }));
      return category;
    },
    updateBudgetCategory(id, patch) {
      commit((db) => ({
        ...db,
        budgetCategories: db.budgetCategories.map((c) =>
          c.id === id
            ? {
                ...c,
                ...patch,
                name: (patch.name ?? c.name).trim(),
                updatedAt: nowInstant(),
              }
            : c,
        ),
      }));
    },
    /** Transactions filed under it keep their history, minus the label. */
    removeBudgetCategory(id) {
      const at = nowInstant();
      const removed = get().db.budgetCategories.find((c) => c.id === id);
      const filedUnderIt = get()
        .db.transactions.filter((t) => t.categoryId === id)
        .map((t) => t.id);
      commit((db) => ({
        ...db,
        budgetCategories: db.budgetCategories.filter((c) => c.id !== id),
        transactions: db.transactions.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null, updatedAt: at } : t,
        ),
        tombstones: pruneTombstones([
          ...db.tombstones,
          tombstone("category", id, at),
        ]),
      }));

      if (removed) {
        // Putting the label back is not enough — the entries that were filed
        // under it have to find their way home too.
        const orphaned = new Set(filedUnderIt);
        useUndoStore.getState().push("undoneCategoryRemoved", () => {
          const at2 = nowInstant();
          commit((db) => ({
            ...db,
            budgetCategories: [
              ...db.budgetCategories,
              { ...removed, updatedAt: at2 },
            ],
            transactions: db.transactions.map((t) =>
              orphaned.has(t.id) ? { ...t, categoryId: id, updatedAt: at2 } : t,
            ),
            tombstones: db.tombstones.filter(
              (stone) => !(stone.kind === "category" && stone.id === id),
            ),
          }));
        });
      }
    },
    ensureCategoriesForKeys(keys) {
      const language = get().db.settings.language ?? "tr";
      const mapping: Record<string, string> = {};

      for (const key of keys) {
        const entry = CATEGORY_CATALOGUE[key];
        if (!entry) continue;
        // Both spellings count as "already there": a document started in
        // English holds "Groceries", and adding "Market" beside it would split
        // the very total the import exists to build.
        const wanted = [entry.tr, entry.en].map((name) =>
          name.toLocaleLowerCase("tr"),
        );
        const existing = get().db.budgetCategories.find((category) =>
          wanted.includes(category.name.trim().toLocaleLowerCase("tr")),
        );
        if (existing) {
          mapping[key] = existing.id;
          continue;
        }

        const at = nowInstant();
        const created: BudgetCategory = {
          id: createId("b"),
          name: language === "tr" ? entry.tr : entry.en,
          flow: entry.flow,
          color: entry.color,
          icon: entry.icon,
          // Created by the import, so the user may delete it like their own.
          builtIn: false,
          order: get().db.budgetCategories.length,
          updatedAt: at,
        };
        commit((db) => ({
          ...db,
          budgetCategories: [...db.budgetCategories, created],
        }));
        mapping[key] = created.id;
      }
      return mapping;
    },
    /**
     * Write a confirmed statement import.
     *
     * One commit for the whole file: a statement is a hundred rows, and a
     * hundred separate writes would be a hundred renders and a hundred disk
     * flushes for what the user experienced as a single action.
     */
    importTransactions(drafts, merges = [], batchInfo) {
      if (drafts.length === 0 && merges.length === 0) return 0;

      const db = get().db;
      // The preview may have been built minutes ago; the ledger is the
      // authority on what is already in it.
      const taken = new Set(
        db.transactions
          .filter((t) => t.deletedAt === null && t.externalId)
          .map((t) => t.externalId as string),
      );
      const fresh = drafts.filter((draft) => !taken.has(draft.externalId));
      // A merge whose fingerprint has since been written by another import is
      // no longer a merge; the row it would settle is already settled.
      const settling = merges.filter((m) => !taken.has(m.patch.externalId));
      if (fresh.length === 0 && settling.length === 0) return 0;

      const at = nowInstant();
      const batchId = createId("imp");
      const created = fresh.map((draft) => importedTransaction(draft, batchId, at));
      /*
       * The previous shape of the rows this statement settles rather than
       * repeats. A merge edits a row the user wrote, and an undo that left the
       * bank's merchant and fingerprint behind would not be an undo.
       */
      const patchById = new Map(settling.map((m) => [m.entryId, m.patch]));
      const before = db.transactions.filter((entry) => patchById.has(entry.id));
      const batch = importBatch({ batchId, batchInfo, at, created, before });

      commit((next) => ({
        ...next,
        statementBatches: [...next.statementBatches, batch],
        transactions: [
          ...next.transactions.map((entry) => {
            const patch = patchById.get(entry.id);
            return patch ? { ...entry, ...patch, updatedAt: at } : entry;
          }),
          ...created,
        ],
      }));

      // A hundred rows landing in the wrong month is exactly the mistake
      // someone wants back immediately, and undoing it row by row is no undo.
      // One reversal, two doors: the toast runs what the budget view's list
      // runs, so the two can never drift into disagreeing.
      useUndoStore
        .getState()
        .push("undoneImport", () => void get().revertImport(batchId));

      return created.length + settling.length;
    },
    revertImport(batchId) {
      const db = get().db;
      const batch = db.statementBatches.find((b) => b.id === batchId);
      if (!batch || !batchIsLive(batch)) return 0;

      const at = nowInstant();
      const snapshots = new Map(batch.settled.map((snap) => [snap.id, snap]));
      let touched = 0;

      commit((next) => ({
        ...next,
        statementBatches: next.statementBatches.map((b) =>
          b.id === batchId ? { ...b, revertedAt: at } : b,
        ),
        transactions: next.transactions.map((entry) => {
          /*
           * Rows this import created go back to deleted — soft, so they are in
           * the trash rather than gone, and skipped when the user has already
           * removed them by hand.
           */
          if (entry.importId === batchId) {
            if (entry.deletedAt !== null) return entry;
            touched += 1;
            return { ...entry, deletedAt: at, updatedAt: at };
          }

          /*
           * Rows it stamped go back to what they were. `deletedAt` is
           * deliberately not restored: if the user has thrown one away since,
           * un-deleting it here would resurrect a row they meant to be rid of.
           */
          const snap = snapshots.get(entry.id);
          if (!snap || entry.deletedAt !== null) return entry;
          touched += 1;
          return { ...entry, ...restorePatch(snap), updatedAt: at };
        }),
      }));

      return touched;
    },
    markSpendNudged(date) {
      commit((db) => ({
        ...db,
        settings: { ...db.settings, lastSpendNudgeOn: date },
      }));
    },
    /**
     * Catch the budget up on everything its templates owe.
     *
     * Run on open rather than on a timer: the app may have been closed for a
     * month, and the answer has to be the same either way. Producing them one
     * at a time through the same code path an ordinary entry takes means a
     * generated entry is in no way special — it can be edited, deleted or
     * recategorised like any other.
     */
    materialiseRecurringTransactions(through) {
      const due = dueRecurringTransactions(get().db.transactions, through);
      if (due.length === 0) return 0;

      const at = nowInstant();
      const created: Transaction[] = due.map(({ source, date }) => ({
        id: createId("x"),
        date,
        amountMinor: source.amountMinor,
        flow: source.flow,
        categoryId: source.categoryId,
        note: source.note,
        // The copy is a plain entry: only the template carries the rule, so a
        // generated entry can never start generating entries of its own.
        recurrence: null,
        recurrenceSourceId: source.id,
        lastGeneratedFor: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      }));

      // Remember how far each template has got, or the next run repeats itself.
      const advancedTo = new Map<string, LocalDate>();
      for (const { source, date } of due) {
        const current = advancedTo.get(source.id);
        if (!current || date > current) advancedTo.set(source.id, date);
      }

      commit((db) => ({
        ...db,
        transactions: [
          ...db.transactions.map((t) => {
            const mark = advancedTo.get(t.id);
            return mark === undefined
              ? t
              : { ...t, lastGeneratedFor: mark, updatedAt: at };
          }),
          ...created,
        ],
      }));

      return created.length;
    },
  };
}
