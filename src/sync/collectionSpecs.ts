import type { Occurrence, Reminder } from "@/domain/types";
import type { BudgetCategory, Transaction } from "@/domain/money";
import type { WishlistItem } from "@/domain/wishlist";
import type { Deadline } from "@/domain/deadline";
import type { StatementBatch } from "@/domain/statementBatch";
import {
  budgetCategoryFromRow,
  cloudBudgetCategoryFingerprint,
  cloudDeadlineFingerprint,
  cloudOccurrenceFingerprint,
  cloudReminderFingerprint,
  cloudStatementBatchFingerprint,
  cloudTransactionFingerprint,
  cloudWishlistFingerprint,
  deadlineFromRow,
  localBudgetCategoryFingerprint,
  localDeadlineFingerprint,
  localOccurrenceFingerprint,
  localReminderFingerprint,
  localStatementBatchFingerprint,
  localTransactionFingerprint,
  localWishlistFingerprint,
  occurrenceFromRow,
  reminderFromRow,
  statementBatchFromRow,
  toBudgetCategoryRow,
  toDeadlineRow,
  toOccurrenceRow,
  toReminderRow,
  toStatementBatchRow,
  toTransactionRow,
  toWishlistRow,
  transactionFromRow,
  wishlistFromRow,
} from "@/data/dto";
import type { CollectionSpec } from "./reconcile";
import {
  syncedBatchFingerprints,
  syncedBudgetCategoryFingerprints,
  syncedDeadlineFingerprints,
  syncedOccurrenceFingerprints,
  syncedReminderFingerprints,
  syncedTransactionFingerprints,
  syncedWishlistFingerprints,
} from "./syncedState";

// Every table that reconciles the same way as tasks. Pure data: the per-table
// mappers and fingerprints come from data/dto, the believed-cloud maps from
// syncedState. `isUploadable` mirrors each table's NOT NULL / CHECK constraints
// so one corrupt row cannot fail the whole batch.

const orphanedByTask = (row: Record<string, unknown>, ctx: { liveTaskIds: Set<string> }) =>
  !ctx.liveTaskIds.has(row.task_id as string);

export const OCCURRENCE_SPEC: CollectionSpec<Occurrence> = {
  table: "occurrences",
  synced: syncedOccurrenceFingerprints,
  idOf: (o) => o.id,
  updatedAtOf: (o) => o.updatedAt,
  localFingerprint: localOccurrenceFingerprint,
  cloudFingerprint: cloudOccurrenceFingerprint,
  isOrphan: orphanedByTask,
  isUploadable: (o) => Boolean(o.taskId) && Boolean(o.date),
  toCloud: toOccurrenceRow,
  fromCloud: occurrenceFromRow,
};

const REMINDER_STATUSES = new Set<string>(["PENDING", "FIRED", "DISMISSED"]);

export const REMINDER_SPEC: CollectionSpec<Reminder> = {
  table: "reminders",
  synced: syncedReminderFingerprints,
  isUploadable: (r) =>
    Boolean(r.taskId) && REMINDER_STATUSES.has(r.status as string),
  idOf: (r) => r.id,
  updatedAtOf: (r) => r.updatedAt,
  localFingerprint: localReminderFingerprint,
  cloudFingerprint: cloudReminderFingerprint,
  isOrphan: orphanedByTask,
  toCloud: toReminderRow,
  fromCloud: reminderFromRow,
};

const MONEY_FLOWS = new Set<string>(["INCOME", "EXPENSE", "INVESTMENT"]);

export const TRANSACTION_SPEC: CollectionSpec<Transaction> = {
  table: "transactions",
  synced: syncedTransactionFingerprints,
  idOf: (t) => t.id,
  updatedAtOf: (t) => t.updatedAt,
  localFingerprint: localTransactionFingerprint,
  cloudFingerprint: cloudTransactionFingerprint,
  isUploadable: (t) =>
    Boolean(t.date) &&
    Number.isFinite(t.amountMinor) &&
    MONEY_FLOWS.has(t.flow as string),
  toCloud: toTransactionRow,
  fromCloud: transactionFromRow,
};

export const BUDGET_CATEGORY_SPEC: CollectionSpec<BudgetCategory> = {
  table: "budget_categories",
  synced: syncedBudgetCategoryFingerprints,
  idOf: (c) => c.id,
  updatedAtOf: (c) => c.updatedAt,
  localFingerprint: localBudgetCategoryFingerprint,
  cloudFingerprint: cloudBudgetCategoryFingerprint,
  isUploadable: (c) => Boolean(c.name) && MONEY_FLOWS.has(c.flow as string),
  toCloud: toBudgetCategoryRow,
  fromCloud: budgetCategoryFromRow,
};

export const WISHLIST_SPEC: CollectionSpec<WishlistItem> = {
  table: "wishlist",
  synced: syncedWishlistFingerprints,
  idOf: (item) => item.id,
  updatedAtOf: (item) => item.updatedAt,
  localFingerprint: localWishlistFingerprint,
  cloudFingerprint: cloudWishlistFingerprint,
  isUploadable: (item) => Boolean(item.title),
  toCloud: toWishlistRow,
  fromCloud: wishlistFromRow,
};

export const DEADLINE_SPEC: CollectionSpec<Deadline> = {
  table: "deadlines",
  synced: syncedDeadlineFingerprints,
  idOf: (d) => d.id,
  updatedAtOf: (d) => d.updatedAt,
  localFingerprint: localDeadlineFingerprint,
  cloudFingerprint: cloudDeadlineFingerprint,
  isUploadable: (d) => Boolean(d.taskId && d.label && d.date),
  isOrphan: orphanedByTask,
  toCloud: toDeadlineRow,
  fromCloud: deadlineFromRow,
};

export const BATCH_SPEC: CollectionSpec<StatementBatch> = {
  table: "statement_batches",
  synced: syncedBatchFingerprints,
  idOf: (b) => b.id,
  updatedAtOf: (b) => b.revertedAt ?? b.importedAt,
  localFingerprint: localStatementBatchFingerprint,
  cloudFingerprint: cloudStatementBatchFingerprint,
  isUploadable: (b) => Boolean(b.label && b.from && b.to),
  toCloud: toStatementBatchRow,
  fromCloud: statementBatchFromRow,
};
