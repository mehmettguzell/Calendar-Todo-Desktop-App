import type { Category } from "@/domain/types";
import {
  budgetCategoryFromRow,
  localBudgetCategoryFingerprint,
  localCategoryFingerprint,
  localOccurrenceFingerprint,
  localReminderFingerprint,
  localTaskFingerprint,
  localTransactionFingerprint,
  occurrenceFromRow,
  reminderFromRow,
  taskFromRow,
  transactionFromRow,
} from "@/data/dto";
import { document } from "./ports";
import { pendingIds } from "./queue";
import { acceptsRemoteTask } from "./remoteEcho";
import {
  syncedBudgetCategoryFingerprints,
  syncedCategoryFingerprints,
  syncedOccurrenceFingerprints,
  syncedReminderFingerprints,
  syncedTaskFingerprints,
  syncedTransactionFingerprints,
} from "./syncedState";

// One handler per table the channel carries. Each decides whether the row may
// land here at all, then writes it; `applyRemote` keeps it off the write queue.
export interface RealtimeRowChange {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

/** Would this row overwrite something this device knows better? */
function taskEchoRejected(task: ReturnType<typeof taskFromRow>): boolean {
  const db = document().read();
  return !acceptsRemoteTask({
    remoteUpdatedAt: task.updatedAt,
    remoteDeleted: task.deletedAt !== null,
    localUpdatedAt: db.tasks.find((t) => t.id === task.id)?.updatedAt ?? null,
    tombstoned: db.tombstones.some(
      (stone) => stone.kind === "task" && stone.id === task.id,
    ),
    queued:
      pendingIds.tasks.has(task.id) || pendingIds.deletedTasks.has(task.id),
  });
}

export function handleRealtimeTaskChange(payload: RealtimeRowChange) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    const task = taskFromRow(newRecord, 0, null);
    if (taskEchoRejected(task)) return;

    // A soft delete is a state, not a disappearance: keeping the row is what
    // lets Trash show it and Restore undo it on this device too.
    syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));

    document().apply((db) => {
      const existing = db.tasks.find((t) => t.id === task.id);
      if (!existing) {
        return { ...db, tasks: [...db.tasks, task] };
      }
      // The remote row does not know this device's manual ordering.
      const next = {
        ...task,
        order: existing.order,
        manualOrder: existing.manualOrder ?? null,
      };
      return {
          ...db,
          tasks: db.tasks.map((t) => (t.id === task.id ? next : t)),
        };
    });
    return;
  }

  if (eventType === "DELETE") {
    const id = oldRecord.id as string;
    syncedTaskFingerprints.delete(id);
    document().apply((db) => ({
        ...db,
        tasks: db.tasks.filter((t) => t.id !== id),
        occurrences: db.occurrences.filter((o) => o.taskId !== id),
        reminders: db.reminders.filter((r) => r.taskId !== id),
      }));
  }
}

export function handleRealtimeCategoryChange(payload: RealtimeRowChange) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    if (newRecord.is_deleted) {
      const id = newRecord.id as string;
      syncedCategoryFingerprints.delete(id);
      document().apply((db) => ({
          ...db,
          categories: db.categories.filter((c) => c.id !== id),
          tasks: db.tasks.map((t) =>
            t.categoryId === id ? { ...t, categoryId: null } : t,
          ),
        }));
      return;
    }

    const cat: Category = {
      id: newRecord.id as string,
      name: String(newRecord.name ?? "").trim(),
      color: newRecord.color as string,
      order: 0,
    };

    syncedCategoryFingerprints.set(cat.id, localCategoryFingerprint(cat));

    document().apply((db) => {
      const existing = db.categories.find(
        (c) =>
          c.id === cat.id ||
          c.name.toLowerCase().trim() === cat.name.toLowerCase().trim(),
      );
      const nextCategories = existing
        ? db.categories.map((c) =>
            c.id === existing.id
              ? { ...c, ...cat, id: existing.id, order: c.order }
              : c,
          )
        : [...db.categories, { ...cat, order: db.categories.length }];
      return { ...db, categories: nextCategories };
    });
    return;
  }

  if (eventType === "DELETE") {
    const id = oldRecord.id as string;
    syncedCategoryFingerprints.delete(id);
    document().apply((db) => ({ ...db, categories: db.categories.filter((c) => c.id !== id) }));
  }
}

export function handleRealtimeOccurrenceChange(payload: RealtimeRowChange) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE" || newRecord?.is_deleted) {
    syncedOccurrenceFingerprints.delete(id);
    document().apply((db) => ({ ...db, occurrences: db.occurrences.filter((o) => o.id !== id) }));
    return;
  }

  const occurrence = occurrenceFromRow(newRecord);
  syncedOccurrenceFingerprints.set(id, localOccurrenceFingerprint(occurrence));
  document().apply((db) => {
    const exists = db.occurrences.some((o) => o.id === id);
    return {
        ...db,
        occurrences: exists
          ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
          : [...db.occurrences, occurrence],
      };
  });
}

export function handleRealtimeReminderChange(payload: RealtimeRowChange) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE" || newRecord?.is_deleted) {
    syncedReminderFingerprints.delete(id);
    document().apply((db) => ({ ...db, reminders: db.reminders.filter((r) => r.id !== id) }));
    return;
  }

  const reminder = reminderFromRow(newRecord);
  syncedReminderFingerprints.set(id, localReminderFingerprint(reminder));
  document().apply((db) => {
    const exists = db.reminders.some((r) => r.id === id);
    return {
        ...db,
        reminders: exists
          ? db.reminders.map((r) => (r.id === id ? reminder : r))
          : [...db.reminders, reminder],
      };
  });
}

export function handleRealtimeTransactionChange(payload: RealtimeRowChange) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE") {
    syncedTransactionFingerprints.delete(id);
    document().apply((db) => ({
        ...db,
        transactions: db.transactions.filter((t) => t.id !== id),
      }));
    return;
  }

  // A soft-deleted transaction is kept: the ledger records what happened, and
  // dropping the row would rewrite a past month with nothing to show for it.
  const transaction = transactionFromRow(newRecord);
  syncedTransactionFingerprints.set(
    id,
    localTransactionFingerprint(transaction),
  );
  document().apply((db) => {
    const exists = db.transactions.some((t) => t.id === id);
    return {
        ...db,
        transactions: exists
          ? db.transactions.map((t) => (t.id === id ? transaction : t))
          : [...db.transactions, transaction],
      };
  });
}

export function handleRealtimeBudgetCategoryChange(payload: RealtimeRowChange) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE" || newRecord?.is_deleted) {
    syncedBudgetCategoryFingerprints.delete(id);
    document().apply((db) => ({
        ...db,
        budgetCategories: db.budgetCategories.filter((c) => c.id !== id),
        transactions: db.transactions.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null } : t,
        ),
      }));
    return;
  }

  const category = budgetCategoryFromRow(newRecord);
  syncedBudgetCategoryFingerprints.set(
    id,
    localBudgetCategoryFingerprint(category),
  );
  document().apply((db) => {
    const exists = db.budgetCategories.some((c) => c.id === id);
    return {
        ...db,
        budgetCategories: exists
          ? db.budgetCategories.map((c) => (c.id === id ? category : c))
          : [...db.budgetCategories, category],
      };
  });
}
