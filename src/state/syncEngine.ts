import { supabase } from "@/lib/supabase";

export type { SyncDifferenceReport } from "@/sync";

import { useAuthStore } from "@/state/authStore";
import { useStore } from "@/state/store";
import { useSyncStore } from "@/state/syncStore";
import {
  classifySyncError,
  formatErrorMessage,
} from "@/lib/errors";
import type {
  Category,
  FocusSession,
  Task,
  Tombstone,
} from "@/domain/types";

import {
  clearPending,
  configureRealtime,
  configureRetry,
  currentUserId,
  drainPendingWrites,
  ensureProfileRow,
  forgetLastPass,
  forgetSyncedState,
  hasRealtimeChannel,
  isApplyingRemoteUpdate,
  lastPassAt,
  MIN_FULL_SYNC_INTERVAL_MS,
  pendingCount,
  pendingIds,
  resetPullState,
  resetRetryBudget,
  scheduleFlush,
  setupRealtime,
  syncDifferences,
  teardownRealtime,
  watchConnectivity,
} from "@/sync";

/**
 * ============================================================================
 * How two devices agree on the truth
 * ============================================================================
 *
 * The unit of conflict is one ROW — a task, a category, an occurrence, a
 * reminder. Fields inside a row are never merged: a task edited on the phone
 * and on the desktop resolves to one of the two versions, not to a Frankenstein
 * of both. Field-level merging sounds better until it produces a task whose
 * title came from one device and whose date came from the other, which is a
 * state neither person ever asked for.
 *
 * The winner is the side with the greater `updated_at`, and **ties go to the
 * cloud**. That tie-break looks arbitrary and is the important part: it is the
 * same on every device, so two clients that disagree converge on the same
 * answer instead of pushing their own copy at each other forever.
 *
 * A soft delete is an ordinary field change and follows the same rule. A
 * *purge* is different — the row is gone, and a missing row is indistinguishable
 * from one this device has never seen — so purges leave a tombstone, and a
 * tombstone always wins: it is an explicit act, and the alternative is watching
 * deleted tasks reappear.
 *
 * Order within one pass is dictated by what points at what: categories, then
 * tasks, then the occurrences and reminders that hang off a task.
 *
 * Nothing here is allowed to block the app. Local writes always succeed; the
 * cloud is a replica that catches up. Every network call carries a timeout, and
 * every failure leaves the queue intact so the next attempt retries it.
 */


// withTimeout lives in `@/sync/cloudRequest`, ensureProfileRow in `@/sync/profile`.

let isSyncing = false;
let isStoreSubscribed = false;

let isEngineInitialized = false;
let syncedNamespace: string | null = null;

/**
 * Tail of the account-change chain.
 *
 * `handleAccountChange` tears the engine down and builds it back up around two
 * awaits, so two overlapping runs interleave: the second one's `stopSync()`
 * clears `isSyncing` and removes the channel that the first one is still in the
 * middle of subscribing, leaving a live socket nothing owns and a reconciliation
 * that believes it is still running. Signing out and straight back in is enough
 * to reach that. Chaining the runs makes each one see a settled engine.
 */
let accountChangeChain: Promise<void> = Promise.resolve();

// Missing-table detection lives in `@/sync/schemaCapability`, the skipped-row
// badge in `@/sync/skippedRows`.

/* ------------------------------------------------------------------ */
/* Engine lifecycle                                                    */
/* ------------------------------------------------------------------ */

/**
 * Initializes cross-device cloud synchronization (Desktop ↔ Mobile).
 */
export { syncDifferences };

export function initSyncEngine() {
  // Every listener below outlives the call and none of them is ever released,
  // so a second call doubles them: two auth subscribers each starting their own
  // reconciliation, two `online` handlers each rebuilding the realtime channel.
  // React's development double-invoke of effects calls this twice.
  if (isEngineInitialized) return;
  isEngineInitialized = true;

  if (!supabase) {
    useSyncStore.getState().setPhase("disabled");
  }

  const requestSync = () => {
    void syncDifferences();
  };
  configureRetry({ currentUserId, requestSync });
  // A channel that has just come back missed everything that changed while it
  // was down, so reconcile — unless a pass has only just finished.
  configureRealtime({
    onSubscribed: (userId) => {
      const recentlySynced =
        lastPassAt() > 0 && Date.now() - lastPassAt() < MIN_FULL_SYNC_INTERVAL_MS;
      if (syncedNamespace === userId && !isSyncing && !recentlySynced) {
        requestSync();
      }
    },
  });

  // Auth drives everything: which local document is open, and which cloud rows
  // are ours. Both have to move together, or one account briefly sees the
  // other's tasks.
  useAuthStore.subscribe((state, prevState) => {
    const prevUserId =
      prevState.user?.id ?? prevState.session?.user?.id ?? null;
    const nextUserId = state.user?.id ?? state.session?.user?.id ?? null;
    if (nextUserId === prevUserId) return;

    void enqueueAccountChange(nextUserId);
  });

  // Watch local Zustand store mutations and automatically sync to Supabase
  if (!isStoreSubscribed) {
    isStoreSubscribed = true;
    useStore.subscribe((state, prevState) => {
      const userId = currentUserId();
      if (!supabase || !userId || isApplyingRemoteUpdate()) return;

      // Zustand updates are immutable, so an untouched row keeps its identity:
      // a reference check finds the changed rows without walking their fields.
      queueChangedById(prevState.db.tasks, state.db.tasks, pendingIds.tasks);
      queueChangedById(
        prevState.db.categories,
        state.db.categories,
        pendingIds.categories,
      );
      queueChangedById(
        prevState.db.occurrences,
        state.db.occurrences,
        pendingIds.occurrences,
      );
      queueChangedById(
        prevState.db.reminders,
        state.db.reminders,
        pendingIds.reminders,
      );
      queueChangedById(
        prevState.db.transactions,
        state.db.transactions,
        pendingIds.transactions,
      );
      queueChangedById(
        prevState.db.budgetCategories,
        state.db.budgetCategories,
        pendingIds.budgetCategories,
      );

      const prevFocusIds = new Set(prevState.db.focusSessions.map((f) => f.id));
      for (const session of state.db.focusSessions) {
        if (!prevFocusIds.has(session.id)) pendingIds.focus.add(session.id);
      }

      // Append-only, so only the new ids are ever interesting.
      if (prevState.db.history !== state.db.history) {
        const prevHistoryIds = new Set(prevState.db.history.map((h) => h.id));
        for (const entry of state.db.history) {
          if (!prevHistoryIds.has(entry.id)) pendingIds.history.add(entry.id);
        }
      }

      // A tombstone is the only durable record that a purge happened, so new
      // ones become deletes on the wire.
      if (prevState.db.tombstones !== state.db.tombstones) {
        queueTombstones(prevState.db.tombstones, state.db.tombstones);
      }

      if (pendingCount() > 0) scheduleFlush();
    });
  }

  // Initial check if already logged in
  const userId = currentUserId();
  if (userId) {
    void enqueueAccountChange(userId);
  }

  watchConnectivity({
    currentUserId,
    resetRetryBudget,
    drainQueuedWrites: drainPendingWrites,
    setupRealtime,
    hasRealtimeChannel,
    requestSync,
  });
}

/** Rows present in `next` that are not the same object as in `prev`. */
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
function enqueueAccountChange(userId: string | null): Promise<void> {
  accountChangeChain = accountChangeChain
    .catch(() => undefined)
    .then(() => handleAccountChange(userId));
  return accountChangeChain;
}

async function handleAccountChange(userId: string | null): Promise<void> {
  stopSync();
  forgetSyncedState();
  clearPending();
  // Signing in is a condition too — and neither the failures nor the recent
  // answers of the account being signed out of may carry over to the new one.
  resetRetryBudget();
  forgetLastPass();

  await useStore.getState().switchAccount(userId);

  if (!userId) {
    useSyncStore.getState().setPhase(supabase ? "disabled" : "disabled");
    return;
  }
  await startSync(userId);
}

async function startSync(userId: string) {
  if (!supabase || isSyncing) return;
  isSyncing = true;
  syncedNamespace = userId;

  try {
    // Realtime first: subscribing before the reconciliation means edits that
    // land on another device *during* the initial pass still arrive, instead of
    // falling into the gap between "finished reading" and "started listening".
    setupRealtime(userId);

    await ensureProfileRow(userId);

    // One reconciliation pass covers both directions. The old startup did a
    // blind push of every local row followed by a blind pull of every cloud
    // row, so logging in rewrote the user's entire table twice.
    const report = await syncDifferences();
    if (!report.success && report.error && report.error !== "offline") {
      console.warn("[tempo sync] initial sync failed:", report.error);
    }
  } catch (err) {
    const kind = classifySyncError(err);
    console.error(
      `[tempo sync] startup failed (${kind}):`,
      formatErrorMessage(err),
    );
    useSyncStore.getState().setPhase("error", kind);
  } finally {
    isSyncing = false;
  }
}

function stopSync() {
  teardownRealtime();
  isSyncing = false;
  syncedNamespace = null;
  resetPullState();
  useSyncStore.getState().setRealtime("down");
}

// The reconciliation pass lives in `@/sync/differences`, realtime in
// `@/sync/realtime`, the write queue and flush in `@/sync/queue` and
// `@/sync/writeFlush`.
// Retry backoff lives in `@/sync/retry`, the connectivity listeners in
// `@/sync/connectivity`; both are wired from initSyncEngine.
// The believed-cloud fingerprint maps and the pull cursor live in
// `@/sync/syncedState` and `@/sync/pullCursor`.

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Queue entry points used by the store                                */
/* ------------------------------------------------------------------ */

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

