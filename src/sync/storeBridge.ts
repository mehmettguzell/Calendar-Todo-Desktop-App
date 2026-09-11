import type { Category, FocusSession, Task, Tombstone } from "@/domain/types";
import { supabase } from "@/lib/supabase";
import { document } from "./ports";
import { currentUserId } from "./account";
import { pendingCount, pendingIds } from "./queue";
import { isApplyingRemoteUpdate } from "./remoteApply";
import { scheduleFlush } from "./writeFlush";

// The store cannot tell a local edit from an applied cloud row, so this bridge
// runs only while no remote apply is in progress.
let isStoreSubscribed = false;

function queueChangedById<T extends { id: string }>(
  prev: T[],
  next: T[],
  target: Set<string>,
): void {
  if (prev === next) return;
  const prevById = new Map(prev.map((row) => [row.id, row]));
  for (const row of next) {
    if (prevById.get(row.id) !== row) target.add(row.id);
  }
}

function queueTombstones(prev: Tombstone[], next: Tombstone[]): void {
  const known = new Set(prev.map((t) => `${t.kind}:${t.id}`));
  for (const stone of next) {
    if (known.has(`${stone.kind}:${stone.id}`)) continue;
    switch (stone.kind) {
      case "task":
        pendingIds.tasks.delete(stone.id);
        pendingIds.deletedTasks.add(stone.id);
        break;
      case "category":
        // Task categories and budget categories share a tombstone kind but live
        // in different tables. Both queues take the id; whichever table does
        // not have that row simply updates nothing.
        pendingIds.categories.delete(stone.id);
        pendingIds.deletedCategories.add(stone.id);
        pendingIds.budgetCategories.delete(stone.id);
        pendingIds.deletedBudgetCategories.add(stone.id);
        break;
      case "reminder":
        pendingIds.reminders.delete(stone.id);
        pendingIds.deletedReminders.add(stone.id);
        break;
      case "occurrence":
        pendingIds.occurrences.delete(stone.id);
        pendingIds.deletedOccurrences.add(stone.id);
        break;
      case "transaction":
        // Transactions are soft-deleted, so the row itself carries the fact and
        // travels as an ordinary update.
        pendingIds.transactions.add(stone.id);
        break;
      default:
        break;
    }
  }
}

/**
 * Sign-in, sign-out and account switches all land here.
 *
 * The local document is swapped BEFORE any cloud traffic starts. Doing it the
 * other way round uploads whatever happened to be on screen — which, right
 * after a second person signs in on a shared machine, is the first person's
 * task list.
 */
/** Run account changes one at a time, in the order they arrived. */
/** Queue whatever a local mutation changed, then start the flush timer. */
export function watchLocalDocument(): void {
  if (isStoreSubscribed) return;
  isStoreSubscribed = true;
  document().subscribe((next, previous) => {
    const userId = currentUserId();
    if (!supabase || !userId || isApplyingRemoteUpdate()) return;

    // Zustand updates are immutable, so an untouched row keeps its identity:
    // a reference check finds the changed rows without walking their fields.
    queueChangedById(previous.tasks, next.tasks, pendingIds.tasks);
    queueChangedById(
      previous.categories,
      next.categories,
      pendingIds.categories,
    );
    queueChangedById(
      previous.occurrences,
      next.occurrences,
      pendingIds.occurrences,
    );
    queueChangedById(
      previous.reminders,
      next.reminders,
      pendingIds.reminders,
    );
    queueChangedById(
      previous.transactions,
      next.transactions,
      pendingIds.transactions,
    );
    queueChangedById(
      previous.budgetCategories,
      next.budgetCategories,
      pendingIds.budgetCategories,
    );

    const prevFocusIds = new Set(previous.focusSessions.map((f) => f.id));
    for (const session of next.focusSessions) {
      if (!prevFocusIds.has(session.id)) pendingIds.focus.add(session.id);
    }

    // Append-only, so only the new ids are ever interesting.
    if (previous.history !== next.history) {
      const prevHistoryIds = new Set(previous.history.map((h) => h.id));
      for (const entry of next.history) {
        if (!prevHistoryIds.has(entry.id)) pendingIds.history.add(entry.id);
      }
    }

    // A tombstone is the only durable record that a purge happened, so new
    // ones become deletes on the wire.
    if (previous.tombstones !== next.tombstones) {
      queueTombstones(previous.tombstones, next.tombstones);
    }

    if (pendingCount() > 0) scheduleFlush();
  });
}

/**
 * Queues one task for the next batched cloud write.
 *
 * Callers in the store fire this per mutation; the store subscriber queues the
 * same ids independently. Both land in the same set, so an edit that touches
 * ten tasks still costs a single request.
 */
export function syncTaskToCloud(task: Task): void {
  if (!supabase || !currentUserId()) return;
  if (task.categoryId) pendingIds.categories.add(task.categoryId);
  pendingIds.tasks.add(task.id);
  scheduleFlush();
}

/** Queues a soft delete (`is_deleted = true`) for the next batched write. */
export function syncDeleteTaskToCloud(taskId: string): void {
  if (!supabase || !currentUserId()) return;
  pendingIds.tasks.delete(taskId);
  pendingIds.deletedTasks.add(taskId);
  scheduleFlush();
}

/** Queues one category for the next batched cloud write. */
export function syncCategoryToCloud(cat: Category): void {
  if (!supabase || !currentUserId()) return;
  pendingIds.categories.add(cat.id);
  scheduleFlush();
}

/** Queues a category soft delete for the next batched write. */
export function syncDeleteCategoryToCloud(categoryId: string): void {
  if (!supabase || !currentUserId()) return;
  pendingIds.categories.delete(categoryId);
  pendingIds.deletedCategories.add(categoryId);
  scheduleFlush();
}

/** Queues one focus session for the next batched cloud write. */
export function syncFocusSessionToCloud(session: FocusSession): void {
  if (!supabase || !currentUserId()) return;
  pendingIds.focus.add(session.id);
  scheduleFlush();
}

