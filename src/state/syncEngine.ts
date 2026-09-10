import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  deduplicateBudgetCategories,
  deduplicateCategories,
  pruneTombstones,
} from "@/data/db";
import { useAuthStore } from "@/state/authStore";
import { persist, useStore } from "@/state/store";
import { isOnline, useSyncStore } from "@/state/syncStore";
import {
  classifySyncError,
  formatErrorMessage,
  type SyncFailureKind,
} from "@/lib/errors";
import type {
  Category,
  FocusSession,
  Task,
  Tombstone,
} from "@/domain/types";
import type { HistoryEntry } from "@/domain/types";
import {
  budgetCategoryFromRow,
  cloudCategoryFingerprint,
  cloudTaskFingerprint,
  localBudgetCategoryFingerprint,
  localCategoryFingerprint,
  localDeadlineFingerprint,
  localOccurrenceFingerprint,
  localReminderFingerprint,
  localStatementBatchFingerprint,
  localTaskFingerprint,
  localTransactionFingerprint,
  localWishlistFingerprint,
  occurrenceFromRow,
  reminderFromRow,
  taskFromRow,
  toCategoryRow,
  transactionFromRow,
} from "@/data/dto";
import {
  acceptsRemoteTask,
  BATCH_SPEC,
  beginRemoteApply,
  BUDGET_CATEGORY_SPEC,
  chunked,
  clearPending,
  configureRetry,
  currentUserId,
  DEADLINE_SPEC,
  drainPendingWrites,
  endRemoteApply,
  ensureProfileRow,
  forgetSyncedState,
  FULL_PASS_INTERVAL_MS,
  getLastFullPassAt,
  getPullCursor,
  isApplyingRemoteUpdate,
  isMissingRelation,
  markFullPassDone,
  newestStamp,
  noteRelationMissing,
  OCCURRENCE_SPEC,
  pendingCount,
  pendingIds,
  reconcileCollection,
  REMINDER_SPEC,
  resetPullState,
  resetRetryBudget,
  retriesAllowed,
  rewound,
  scheduleFlush,
  scheduleRetry,
  setPullCursor,
  type SyncContext,
  syncedBatchFingerprints,
  syncedBudgetCategoryFingerprints,
  syncedCategoryFingerprints,
  syncedDeadlineFingerprints,
  syncedFocusIds,
  syncedHistoryIds,
  syncedOccurrenceFingerprints,
  syncedReminderFingerprints,
  syncedTaskFingerprints,
  syncedTransactionFingerprints,
  syncedWishlistFingerprints,
  tableAvailable,
  TRANSACTION_SPEC,
  UPSERT_CHUNK_SIZE,
  upsertTasksToCloud,
  watchConnectivity,
  WISHLIST_SPEC,
  withTimeout,
  writeFocusSessions,
  writeHistory,
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

let realtimeChannel: RealtimeChannel | null = null;
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
    hasRealtimeChannel: () => realtimeChannel !== null,
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
  lastReport = null;
  lastReportAt = 0;

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
  if (realtimeChannel && supabase) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isSyncing = false;
  syncedNamespace = null;
  resetPullState();
  useSyncStore.getState().setRealtime("down");
}

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

/* ------------------------------------------------------------------ */
/* Full reconciliation                                                 */
/* ------------------------------------------------------------------ */

export interface SyncDifferenceReport {
  success: boolean;
  uploadedTasks: number;
  downloadedTasks: number;
  uploadedCategories: number;
  downloadedCategories: number;
  totalDifferences: number;
  /** A failure *code*, never backend text. See `SyncFailureKind`. */
  error?: SyncFailureKind;
}

function emptyReport(error: SyncFailureKind): SyncDifferenceReport {
  return {
    success: false,
    uploadedTasks: 0,
    downloadedTasks: 0,
    uploadedCategories: 0,
    downloadedCategories: 0,
    totalDifferences: 0,
    error,
  };
}

let differencesInFlight: Promise<SyncDifferenceReport> | null = null;
let lastReport: SyncDifferenceReport | null = null;
let lastReportAt = 0;

/**
 * The floor between two full reconciliations.
 *
 * One pass reads every row of nine tables in both directions. That is the
 * right price to pay once; it is the wrong price to pay eleven times because
 * somebody drummed the button. Two presses a second apart already share one
 * pass through `differencesInFlight` — this covers the case that guard cannot,
 * where each press lands *after* the previous pass returned.
 *
 * A press inside the window is not ignored: queued local edits are still
 * flushed, which is the cheap half and the half that actually carries the
 * user's work. Only the expensive full read is skipped, and the answer given
 * back is the one the last pass established seconds ago.
 */
const MIN_FULL_SYNC_INTERVAL_MS = 60_000;

function unchangedReport(): SyncDifferenceReport {
  return {
    success: true,
    uploadedTasks: 0,
    downloadedTasks: 0,
    uploadedCategories: 0,
    downloadedCategories: 0,
    totalDifferences: 0,
  };
}

/**
 * Reconcile local and cloud in both directions, by content.
 *
 * This is the safety net the whole design leans on: it needs no queue, no
 * journal and no memory of what happened while the app was closed. It compares
 * what each side actually holds, so an edit made offline three restarts ago is
 * found the same way as one made a second ago.
 *
 * Concurrent callers share one pass — the manual button, the reconnect handler
 * and the realtime catch-up all fire at moments that overlap.
 */
export async function syncDifferences(
  options: { manual?: boolean } = {},
): Promise<SyncDifferenceReport> {
  // Pressing the button is the clearest condition there is: the user is asking
  // for one more attempt, so the spent budget is restored before the check.
  if (options.manual) {
    resetRetryBudget();
    lastReport = null;
    lastReportAt = 0;
  }
  if (!retriesAllowed()) {
    return emptyReport(useSyncStore.getState().lastFailure ?? "unknown");
  }
  if (differencesInFlight) return differencesInFlight;

  if (lastReport && Date.now() - lastReportAt < MIN_FULL_SYNC_INTERVAL_MS) {
    // Still worth pushing whatever was typed in the meantime — that is one
    // small upsert, not a re-read of the whole account.
    await drainPendingWrites();
    // That flush is the freshest thing that happened, so it, not the cached
    // pass, decides the answer: a toast saying "up to date" over a red badge
    // would be the app contradicting itself.
    const failure = useSyncStore.getState().lastFailure;
    if (failure) return emptyReport(failure);
    return lastReport.success
      ? unchangedReport()
      : emptyReport(lastReport.error ?? "unknown");
  }

  // Rebuilt by this pass. A row repaired since the last one must stop counting
  // the moment it goes through, not at the next restart.
  useSyncStore.getState().clearSkipped();

  differencesInFlight = runSyncDifferences()
    .then((report) => {
      lastReport = report;
      lastReportAt = Date.now();
      return report;
    })
    .finally(() => {
      differencesInFlight = null;
    });
  return differencesInFlight;
}

async function runSyncDifferences(): Promise<SyncDifferenceReport> {
  if (!isOnline()) {
    useSyncStore.getState().setPhase("offline");
    return emptyReport("offline");
  }

  const userId = currentUserId();
  if (!supabase || !userId) {
    useSyncStore.getState().setPhase("disabled");
    return emptyReport("auth");
  }

  useSyncStore.getState().setPhase("syncing");

  beginRemoteApply();
  let uploadedTasks = 0;
  let downloadedTasks = 0;
  let uploadedCategories = 0;
  let downloadedCategories = 0;

  try {
    // Anything already queued belongs in this pass, not racing alongside it.
    // Inside the try on purpose: this used to run before it, so a failure here
    // escaped the catch below and left the phase reading "syncing" for the rest
    // of the session — a spinner that never resolves and never explains itself.
    await drainPendingWrites();

    await ensureProfileRow(userId);

    /*
     * A full pass reads the whole account; an incremental one reads only what
     * changed since the last success. The difference matters beyond bandwidth:
     * only a full set can answer "the cloud is missing this row", so the
     * branches that upload on that basis are skipped below when `incremental`.
     */
    const cursor = getPullCursor();
    const fullPassDue =
      Date.now() - getLastFullPassAt() >= FULL_PASS_INTERVAL_MS;
    const incremental =
      cursor !== null && cursor.userId === userId && !fullPassDue;
    const since = incremental ? cursor : null;

    // 1. Fetch cloud data — everything, or everything new
    const [
      tasksRes,
      catsRes,
      focusRes,
      occRes,
      remRes,
      txRes,
      budgetCatRes,
      wishlistRes,
      deadlinesRes,
      batchesRes,
      historyRes,
    ] = await Promise.all([
      withTimeout(
        sinceFilter(
          supabase.from("tasks").select("*").eq("user_id", userId),
          "updated_at",
          rewound(since?.tasks ?? null),
        ),
        "task fetch",
      ),
      withTimeout(
        sinceFilter(
          supabase.from("categories").select("*").eq("user_id", userId),
          "updated_at",
          rewound(since?.categories ?? null),
        ),
        "category fetch",
      ),
      withTimeout(
        sinceFilter(
          supabase.from("focus_sessions").select("*").eq("user_id", userId),
          "created_at",
          rewound(since?.focus ?? null),
        ),
        "focus fetch",
      ),
      fetchOptional("occurrences", userId),
      fetchOptional("reminders", userId),
      fetchOptional("transactions", userId),
      fetchOptional("budget_categories", userId),
      fetchOptional("wishlist", userId),
      fetchOptional("deadlines", userId),
      fetchOptional("statement_batches", userId),
      fetchOptional("task_history", userId, {
        limit: 100,
        orderColumn: "at",
        ascending: false,
      }),
    ]);

    if (tasksRes.error) throw tasksRes.error;
    if (catsRes.error) throw catsRes.error;

    const cloudTasksRaw = tasksRes.data ?? [];
    const cloudCatsRaw = catsRes.data ?? [];

    const localDb = useStore.getState().db;
    const tombstoned = tombstoneIndex(localDb.tombstones);

    /* --- CATEGORIES --------------------------------------------------- */
    const localCatMap = new Map(localDb.categories.map((c) => [c.id, c]));
    const localCatByName = new Map(
      localDb.categories.map((c) => [c.name.trim().toLowerCase(), c]),
    );
    const cloudCatMap = new Map(cloudCatsRaw.map((c) => [c.id, c]));

    const catsToUpload: Category[] = [];
    for (const localCat of localDb.categories) {
      const cloudCat = cloudCatMap.get(localCat.id);
      // Absent from a partial fetch means "unchanged lately", not "missing".
      const missing = !cloudCat && !incremental;
      const differs =
        cloudCat !== undefined &&
        cloudCategoryFingerprint(cloudCat) !==
          localCategoryFingerprint(localCat);
      if (missing || differs) {
        catsToUpload.push(localCat);
        uploadedCategories++;
      }
    }

    if (catsToUpload.length > 0) {
      const now = new Date().toISOString();
      for (const batch of chunked(catsToUpload, UPSERT_CHUNK_SIZE)) {
        const { error } = await withTimeout(
          supabase.from("categories").upsert(
            batch.map((c) => toCategoryRow(c, userId, now)),
            { onConflict: "id,user_id" },
          ),
          "category upsert",
        );
        if (error) throw error;
      }
    }

    const mergedCats = [...localDb.categories];
    const duplicateCloudCategoryIdsToDelete: string[] = [];

    for (const cloudCat of cloudCatsRaw) {
      if (cloudCat.is_deleted) continue;
      if (tombstoned.category.has(cloudCat.id)) {
        // Deleted here for good; teach the cloud rather than take it back.
        duplicateCloudCategoryIdsToDelete.push(cloudCat.id);
        continue;
      }
      const normalizedName = (cloudCat.name || "").trim().toLowerCase();
      if (!normalizedName) continue;

      // Already present locally, by id or by name.
      if (localCatMap.has(cloudCat.id)) continue;
      if (localCatByName.has(normalizedName)) {
        // Cloud holds a same-named duplicate: retire it there.
        duplicateCloudCategoryIdsToDelete.push(cloudCat.id);
        continue;
      }

      const newCat: Category = {
        id: cloudCat.id,
        name: cloudCat.name.trim(),
        color: cloudCat.color,
        order: mergedCats.length,
      };
      mergedCats.push(newCat);
      localCatByName.set(normalizedName, newCat);
      downloadedCategories++;
    }

    if (duplicateCloudCategoryIdsToDelete.length > 0) {
      void supabase
        .from("categories")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in("id", duplicateCloudCategoryIdsToDelete)
        .eq("user_id", userId);
    }

    /* --- TASKS -------------------------------------------------------- */
    const localTaskMap = new Map(localDb.tasks.map((t) => [t.id, t]));
    const cloudTaskMap = new Map(cloudTasksRaw.map((t) => [t.id, t]));

    const tasksToUpload: Task[] = [];
    const resurrectedTaskIds: string[] = [];
    const mergedTasks = new Map<string, Task>(
      localDb.tasks.map((t) => [t.id, t]),
    );

    for (const localTask of localDb.tasks) {
      const cloudTask = cloudTaskMap.get(localTask.id);
      if (!cloudTask) {
        // Same reasoning as categories: only a full pass can tell a row the
        // cloud never received from one it simply has not changed today.
        if (!incremental) {
          tasksToUpload.push(localTask);
          uploadedTasks++;
        }
        continue;
      }

      if (cloudTaskFingerprint(cloudTask) === localTaskFingerprint(localTask)) {
        continue;
      }

      // Row-level last-write-wins; ties go to the cloud so both devices pick
      // the same winner and stop trading versions.
      const cloudWins =
        new Date(cloudTask.updated_at).getTime() >=
        new Date(localTask.updatedAt).getTime();

      if (cloudWins) {
        mergedTasks.set(
          localTask.id,
          taskFromRow(
            cloudTask,
            localTask.order,
            localTask.manualOrder ?? null,
          ),
        );
        downloadedTasks++;
      } else {
        tasksToUpload.push(localTask);
        uploadedTasks++;
      }
    }

    for (const cloudTask of cloudTasksRaw) {
      if (localTaskMap.has(cloudTask.id)) continue;
      if (cloudTask.is_deleted) continue;
      if (tombstoned.task.has(cloudTask.id)) {
        // Purged on this device. The absence is a decision, not a gap.
        resurrectedTaskIds.push(cloudTask.id);
        continue;
      }
      mergedTasks.set(
        cloudTask.id,
        taskFromRow(cloudTask, mergedTasks.size, null),
      );
      downloadedTasks++;
    }

    if (tasksToUpload.length > 0) {
      const { error: taskUpsertErr } = await upsertTasksToCloud(
        tasksToUpload,
        userId,
      );
      if (taskUpsertErr) {
        console.error("[tempo sync] tasks upsert error:", taskUpsertErr);
        throw taskUpsertErr;
      }
    }

    if (resurrectedTaskIds.length > 0) {
      await withTimeout(
        supabase
          .from("tasks")
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .in("id", resurrectedTaskIds)
          .eq("user_id", userId),
        "task tombstone push",
      );
    }

    const nextTasks = Array.from(mergedTasks.values());
    const nextTaskIds = new Set(nextTasks.map((t) => t.id));

    /* --- OCCURRENCES & REMINDERS -------------------------------------- */
    const context: SyncContext = { liveTaskIds: nextTaskIds };
    const mergedOccurrences = await reconcileCollection(
      OCCURRENCE_SPEC,
      localDb.occurrences,
      occRes,
      tombstoned.occurrence,
      context,
      userId,
    );
    const mergedReminders = await reconcileCollection(
      REMINDER_SPEC,
      localDb.reminders,
      remRes,
      tombstoned.reminder,
      context,
      userId,
    );

    /* --- BUDGET ------------------------------------------------------- */
    const mergedBudgetCategories = await reconcileCollection(
      BUDGET_CATEGORY_SPEC,
      localDb.budgetCategories,
      budgetCatRes,
      tombstoned.category,
      context,
      userId,
    );
    const mergedTransactions = await reconcileCollection(
      TRANSACTION_SPEC,
      localDb.transactions,
      txRes,
      tombstoned.transaction,
      context,
      userId,
    );
    // Nothing ever hard-deletes a wish, so there are no tombstones to consult:
    // an item that is gone is an item carrying `deletedAt`, and that travels
    // as an ordinary field.
    const mergedWishlist = await reconcileCollection(
      WISHLIST_SPEC,
      localDb.wishlist,
      wishlistRes,
      new Set<string>(),
      context,
      userId,
    );
    // Soft-deleted like a wish rather than tombstoned like a reminder: undo
    // has to be able to put a checkpoint back, so removal is a field change.
    const mergedDeadlines = await reconcileCollection(
      DEADLINE_SPEC,
      localDb.deadlines,
      deadlinesRes,
      new Set<string>(),
      context,
      userId,
    );
    const mergedBatches = await reconcileCollection(
      BATCH_SPEC,
      localDb.statementBatches,
      batchesRes,
      new Set<string>(),
      context,
      userId,
    );

    /* --- FOCUS SESSIONS ----------------------------------------------- */
    const cloudFocusRaw = focusRes.data ?? [];
    const duplicateCloudFocusIdsToDelete: string[] = [];

    const localFocusMap = new Map(localDb.focusSessions.map((f) => [f.id, f]));
    const cloudFocusIds = new Set(cloudFocusRaw.map((f) => f.id));

    // Focus rows are hard-deleted rather than flagged, so a deletion made on
    // another device is invisible to an incremental read — there is no row to
    // carry the news. Both directions of focus reconciliation therefore wait
    // for a full pass.
    const focusToUpload = incremental
      ? []
      : localDb.focusSessions.filter(
          (f) => !cloudFocusIds.has(f.id) && !tombstoned.focus.has(f.id),
        );
    if (focusToUpload.length > 0) {
      await writeFocusSessions(focusToUpload, userId);
    }

    const mergedFocus = [...localDb.focusSessions];
    for (const f of cloudFocusRaw) {
      if (tombstoned.focus.has(f.id)) {
        duplicateCloudFocusIdsToDelete.push(f.id);
        continue;
      }
      if (localFocusMap.has(f.id)) continue;

      const newSession: FocusSession = {
        id: f.id,
        taskId: f.task_id,
        occurrenceDate: null,
        startedAt: f.started_at,
        endedAt: null,
        durationSec: f.duration_sec,
      };
      mergedFocus.push(newSession);
      localFocusMap.set(f.id, newSession);
    }

    if (duplicateCloudFocusIdsToDelete.length > 0) {
      for (const batch of chunked(
        duplicateCloudFocusIdsToDelete,
        UPSERT_CHUNK_SIZE,
      )) {
        await withTimeout(
          supabase
            .from("focus_sessions")
            .delete()
            .in("id", batch)
            .eq("user_id", userId),
          "focus sessions tombstone push",
        );
      }
    }

    /* --- ACTIVITY TRAIL ----------------------------------------------- */
    // Append-only: the diff is "which ids does each side not have", in both
    // directions, and nothing is ever overwritten.
    let mergedHistory = localDb.history;
    if (historyRes.data) {
      const cloudHistoryIds = new Set(
        historyRes.data.map((h) => h.id as string),
      );
      /*
       * Only the newest hundred entries are ever fetched, so "not in the cloud
       * set" is only meaningful for entries inside that window. Testing the
       * whole local trail against it re-uploaded every older entry on every
       * single pass — a bill that grew with the trail and never went down.
       */
      const oldestCloudAt = historyRes.data.reduce<string | null>(
        (oldest, row) => {
          const at = row.at as string;
          return oldest === null || at < oldest ? at : oldest;
        },
        null,
      );
      await writeHistory(
        localDb.history.filter(
          (h) =>
            !cloudHistoryIds.has(h.id) &&
            (oldestCloudAt === null || h.at >= oldestCloudAt),
        ),
        userId,
      );

      const byId = new Map(localDb.history.map((h) => [h.id, h]));
      for (const row of historyRes.data) {
        const id = row.id as string;
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          taskId: row.task_id as string,
          at: row.at as string,
          kind: row.kind as HistoryEntry["kind"],
          occurrenceDate: (row.occurrence_date as string) ?? null,
          field: (row.field as string) ?? null,
          from: (row.from_value as string) ?? null,
          to: (row.to_value as string) ?? null,
          note: (row.note as string) ?? null,
        });
      }
      mergedHistory = Array.from(byId.values()).sort((a, b) =>
        a.at.localeCompare(b.at),
      );
    }

    /* --- COMMIT ------------------------------------------------------- */
    const lang = useStore.getState().db.settings?.language ?? "tr";
    const { categories: nextCategories, tasks: syncedTasks } = deduplicateCategories(
      mergedCats,
      nextTasks,
      lang,
    );
    const { budgetCategories: nextBudgetCategories, transactions: syncedTransactions } =
      deduplicateBudgetCategories(
        mergedBudgetCategories,
        mergedTransactions,
        lang,
      );
    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: syncedTasks,
        categories: nextCategories,
        occurrences: mergedOccurrences,
        reminders: mergedReminders,
        transactions: syncedTransactions,
        budgetCategories: nextBudgetCategories,
        wishlist: mergedWishlist,
        deadlines: mergedDeadlines,
        statementBatches: mergedBatches,
        focusSessions: mergedFocus,
        history: mergedHistory,
        tombstones: pruneTombstones(s.db.tombstones),
      },
    }));
    persist(useStore.getState().db);

    // Both sides are reconciled now, so record the agreed content. The next
    // local edit compares against this and sends only what actually moved.
    forgetSyncedState();
    for (const task of nextTasks) {
      syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));
    }
    for (const cat of nextCategories) {
      syncedCategoryFingerprints.set(cat.id, localCategoryFingerprint(cat));
    }
    for (const o of mergedOccurrences) {
      syncedOccurrenceFingerprints.set(o.id, localOccurrenceFingerprint(o));
    }
    for (const r of mergedReminders) {
      syncedReminderFingerprints.set(r.id, localReminderFingerprint(r));
    }
    for (const t of mergedTransactions) {
      syncedTransactionFingerprints.set(t.id, localTransactionFingerprint(t));
    }
    for (const c of mergedBudgetCategories) {
      syncedBudgetCategoryFingerprints.set(
        c.id,
        localBudgetCategoryFingerprint(c),
      );
    }
    for (const item of mergedWishlist) {
      syncedWishlistFingerprints.set(item.id, localWishlistFingerprint(item));
    }
    for (const d of mergedDeadlines) {
      syncedDeadlineFingerprints.set(d.id, localDeadlineFingerprint(d));
    }
    for (const b of mergedBatches) {
      syncedBatchFingerprints.set(b.id, localStatementBatchFingerprint(b));
    }
    for (const session of mergedFocus) syncedFocusIds.add(session.id);
    for (const entry of mergedHistory) syncedHistoryIds.add(entry.id);

    /*
     * Both sides now agree, so the next pass can ask for changes only.
     *
     * The watermark is the newest timestamp the *server* returned, never this
     * device's clock: two machines disagreeing about the time by a few seconds
     * is ordinary, and a cursor built from local time would step over rows
     * written in that gap. A fetch that returned nothing keeps the previous
     * watermark rather than resetting it.
     */
    setPullCursor({
      userId,
      tasks: newestStamp(cloudTasksRaw, "updated_at", since?.tasks ?? null),
      categories: newestStamp(cloudCatsRaw, "updated_at", since?.categories ?? null),
      focus: newestStamp(cloudFocusRaw, "created_at", since?.focus ?? null),
    });
    if (!incremental) markFullPassDone(Date.now());

    useSyncStore.getState().markSynced();
    useSyncStore.getState().setPending(pendingCount());
    resetRetryBudget();

    return {
      success: true,
      uploadedTasks,
      downloadedTasks,
      uploadedCategories,
      downloadedCategories,
      totalDifferences:
        uploadedTasks +
        downloadedTasks +
        uploadedCategories +
        downloadedCategories,
    };
  } catch (err: unknown) {
    const kind = classifySyncError(err);
    console.error(`[tempo sync] reconciliation failed (${kind}):`, err);
    useSyncStore.getState().setPhase(isOnline() ? "error" : "offline", kind);
    scheduleRetry(kind);
    return {
      success: false,
      uploadedTasks,
      downloadedTasks,
      uploadedCategories,
      downloadedCategories,
      totalDifferences: 0,
      error: kind,
    };
  } finally {
    endRemoteApply();
    // A pass may only end in a phase the user can act on. If something escaped
    // both the try and the catch, "syncing" is still on screen and would stay
    // there forever, so it is settled here rather than left spinning.
    if (useSyncStore.getState().phase === "syncing") {
      useSyncStore.getState().setPhase(isOnline() ? "error" : "offline", "unknown");
    }
  }
}

/**
 * Narrow a select to rows touched since the last successful pull.
 *
 * `gte`, not `gt`: the watermark is a row's own timestamp, so the boundary rows
 * come back once more. Re-applying a row the device already has is a no-op the
 * fingerprint check throws away, and that is a far cheaper mistake than `gt`
 * silently skipping a row written in the same millisecond.
 */
function sinceFilter<T extends { gte(column: string, value: string): T }>(
  query: T,
  column: string,
  since: string | null,
): T {
  return since ? query.gte(column, since) : query;
}

/** A select that tolerates the table not existing in this project yet. */
async function fetchOptional(
  table: string,
  userId: string,
  options?: { limit?: number; orderColumn?: string; ascending?: boolean },
): Promise<{ data: Record<string, unknown>[] | null; error: unknown }> {
  if (!supabase || !tableAvailable(table)) return { data: null, error: null };
  let query = supabase.from(table).select("*").eq("user_id", userId);
  if (options?.orderColumn) {
    query = query.order(options.orderColumn, {
      ascending: options.ascending ?? true,
    });
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  const res = await withTimeout(query, `${table} fetch`);
  if (isMissingRelation(res.error)) {
    noteRelationMissing(table);
    return { data: null, error: null };
  }
  return {
    data: res.data as Record<string, unknown>[] | null,
    error: res.error,
  };
}

function tombstoneIndex(tombstones: Tombstone[]) {
  const index = {
    task: new Set<string>(),
    category: new Set<string>(),
    reminder: new Set<string>(),
    occurrence: new Set<string>(),
    transaction: new Set<string>(),
    focus: new Set<string>(),
  };
  for (const stone of tombstones) index[stone.kind]?.add(stone.id);
  return index;
}

/* ------------------------------------------------------------------ */
/* Realtime                                                            */
/* ------------------------------------------------------------------ */

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 0;

const REALTIME_RECONNECT_BASE_MS = 2_000;
const REALTIME_RECONNECT_MAX_MS = 60_000;

/**
 * Carries other devices' edits as they happen (spec: a task added on the phone
 * shows up on the desktop without anyone pressing anything).
 *
 * Two things make this trustworthy rather than best-effort. First, every
 * applied event is written to disk — an update that only lived in memory
 * vanished on the next restart and reappeared as a "difference". Second, a
 * dropped channel reconnects and then runs a full reconciliation, because
 * anything that changed while the socket was down was never delivered at all.
 */
/**
 * Run a realtime handler only for rows that actually came from its table.
 *
 * One channel carries six `postgres_changes` bindings that differ solely by
 * table name. When the server's binding ids and the client's list fall out of
 * step — a reconnect, a binding the project cannot serve — supabase-js fans a
 * payload out to handlers it was never meant for, and a `tasks` row arrives at
 * `handleRealtimeOccurrenceChange`. The mappers below are tolerant by design
 * (`row.task_id as string`, `?? null`), so instead of failing they mint a
 * plausible-looking occurrence with no `taskId` and no `date`. That row is
 * unreachable locally — nothing looks up an occurrence by bare task id — but
 * every later push sends it to a column declared NOT NULL, Postgres rejects
 * the batch, and the whole reconciliation dies. One stray payload is enough to
 * stop sync permanently, which is exactly what happened here.
 *
 * The payload carries the table it came from. Checking it costs nothing.
 */
function onlyFrom<P>(
  table: string,
  handle: (payload: P) => void,
): (payload: P & { table?: string }) => void {
  return (payload) => {
    if (payload.table !== undefined && payload.table !== table) {
      console.warn(
        `[tempo sync] realtime payload from "${payload.table}" was delivered to the "${table}" handler — ignored.`,
      );
      return;
    }
    applyRemote(() => handle(payload));
  };
}

function setupRealtime(userId: string) {
  if (!supabase) return;
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  useSyncStore.getState().setRealtime("connecting");

  const forUser = { schema: "public", filter: `user_id=eq.${userId}` } as const;

  realtimeChannel = supabase
    .channel(`user-sync-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", table: "tasks", ...forUser },
      onlyFrom("tasks", handleRealtimeTaskChange),
    )
    .on(
      "postgres_changes",
      { event: "*", table: "categories", ...forUser },
      onlyFrom("categories", handleRealtimeCategoryChange),
    )
    .on(
      "postgres_changes",
      { event: "*", table: "occurrences", ...forUser },
      onlyFrom("occurrences", handleRealtimeOccurrenceChange),
    )
    .on(
      "postgres_changes",
      { event: "*", table: "reminders", ...forUser },
      onlyFrom("reminders", handleRealtimeReminderChange),
    )
    .on(
      "postgres_changes",
      { event: "*", table: "transactions", ...forUser },
      onlyFrom("transactions", handleRealtimeTransactionChange),
    )
    .on(
      "postgres_changes",
      { event: "*", table: "budget_categories", ...forUser },
      onlyFrom("budget_categories", handleRealtimeBudgetCategoryChange),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        reconnectDelayMs = 0;
        useSyncStore.getState().setRealtime("connected");
        // Whatever happened while we were not listening was never delivered.
        // Reconcile on reconnect only if a sync pass has not just completed.
        const recentlySynced =
          lastReportAt > 0 &&
          Date.now() - lastReportAt < MIN_FULL_SYNC_INTERVAL_MS;
        if (syncedNamespace === userId && !isSyncing && !recentlySynced) {
          void syncDifferences();
        }
        return;
      }
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        useSyncStore.getState().setRealtime("down");
        scheduleRealtimeReconnect(userId);
      }
    });
}

function scheduleRealtimeReconnect(userId: string): void {
  if (reconnectTimer) return;
  reconnectDelayMs =
    reconnectDelayMs === 0
      ? REALTIME_RECONNECT_BASE_MS
      : Math.min(reconnectDelayMs * 2, REALTIME_RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentUserId() === userId && isOnline()) setupRealtime(userId);
  }, reconnectDelayMs);
}

/**
 * Apply a cloud-originated change without echoing it back.
 *
 * The store subscriber cannot tell a remote write from a local one, so the flag
 * is what stops a realtime update from being queued straight back to the server
 * it just came from. The write is persisted here too: an event applied to
 * memory only is lost on the next restart.
 */
function applyRemote(mutate: () => void): void {
  beginRemoteApply();
  try {
    mutate();
  } finally {
    endRemoteApply();
  }
  persist(useStore.getState().db);
}

function handleRealtimeTaskChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    const task = taskFromRow(newRecord, 0, null);
    const db = useStore.getState().db;
    const existingTask = db.tasks.find((t) => t.id === task.id);

    if (
      !acceptsRemoteTask({
        remoteUpdatedAt: task.updatedAt,
        remoteDeleted: task.deletedAt !== null,
        localUpdatedAt: existingTask?.updatedAt ?? null,
        tombstoned: db.tombstones.some(
          (stone) => stone.kind === "task" && stone.id === task.id,
        ),
        queued:
          pendingIds.tasks.has(task.id) || pendingIds.deletedTasks.has(task.id),
      })
    ) {
      return;
    }

    // A soft delete is a state, not a disappearance: keeping the row is what
    // lets Trash show it and Restore undo it on this device too.
    syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));

    useStore.setState((s) => {
      const existing = s.db.tasks.find((t) => t.id === task.id);
      if (!existing) {
        return { db: { ...s.db, tasks: [...s.db.tasks, task] } };
      }
      // The remote row does not know this device's manual ordering.
      const next = {
        ...task,
        order: existing.order,
        manualOrder: existing.manualOrder ?? null,
      };
      return {
        db: {
          ...s.db,
          tasks: s.db.tasks.map((t) => (t.id === task.id ? next : t)),
        },
      };
    });
    return;
  }

  if (eventType === "DELETE") {
    const id = oldRecord.id as string;
    syncedTaskFingerprints.delete(id);
    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: s.db.tasks.filter((t) => t.id !== id),
        occurrences: s.db.occurrences.filter((o) => o.taskId !== id),
        reminders: s.db.reminders.filter((r) => r.taskId !== id),
      },
    }));
  }
}

function handleRealtimeCategoryChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    if (newRecord.is_deleted) {
      const id = newRecord.id as string;
      syncedCategoryFingerprints.delete(id);
      useStore.setState((s) => ({
        db: {
          ...s.db,
          categories: s.db.categories.filter((c) => c.id !== id),
          tasks: s.db.tasks.map((t) =>
            t.categoryId === id ? { ...t, categoryId: null } : t,
          ),
        },
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

    useStore.setState((s) => {
      const existing = s.db.categories.find(
        (c) =>
          c.id === cat.id ||
          c.name.toLowerCase().trim() === cat.name.toLowerCase().trim(),
      );
      const nextCategories = existing
        ? s.db.categories.map((c) =>
            c.id === existing.id
              ? { ...c, ...cat, id: existing.id, order: c.order }
              : c,
          )
        : [...s.db.categories, { ...cat, order: s.db.categories.length }];
      return { db: { ...s.db, categories: nextCategories } };
    });
    return;
  }

  if (eventType === "DELETE") {
    const id = oldRecord.id as string;
    syncedCategoryFingerprints.delete(id);
    useStore.setState((s) => ({
      db: { ...s.db, categories: s.db.categories.filter((c) => c.id !== id) },
    }));
  }
}

function handleRealtimeOccurrenceChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE" || newRecord?.is_deleted) {
    syncedOccurrenceFingerprints.delete(id);
    useStore.setState((s) => ({
      db: { ...s.db, occurrences: s.db.occurrences.filter((o) => o.id !== id) },
    }));
    return;
  }

  const occurrence = occurrenceFromRow(newRecord);
  syncedOccurrenceFingerprints.set(id, localOccurrenceFingerprint(occurrence));
  useStore.setState((s) => {
    const exists = s.db.occurrences.some((o) => o.id === id);
    return {
      db: {
        ...s.db,
        occurrences: exists
          ? s.db.occurrences.map((o) => (o.id === id ? occurrence : o))
          : [...s.db.occurrences, occurrence],
      },
    };
  });
}

function handleRealtimeReminderChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE" || newRecord?.is_deleted) {
    syncedReminderFingerprints.delete(id);
    useStore.setState((s) => ({
      db: { ...s.db, reminders: s.db.reminders.filter((r) => r.id !== id) },
    }));
    return;
  }

  const reminder = reminderFromRow(newRecord);
  syncedReminderFingerprints.set(id, localReminderFingerprint(reminder));
  useStore.setState((s) => {
    const exists = s.db.reminders.some((r) => r.id === id);
    return {
      db: {
        ...s.db,
        reminders: exists
          ? s.db.reminders.map((r) => (r.id === id ? reminder : r))
          : [...s.db.reminders, reminder],
      },
    };
  });
}

function handleRealtimeTransactionChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE") {
    syncedTransactionFingerprints.delete(id);
    useStore.setState((s) => ({
      db: {
        ...s.db,
        transactions: s.db.transactions.filter((t) => t.id !== id),
      },
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
  useStore.setState((s) => {
    const exists = s.db.transactions.some((t) => t.id === id);
    return {
      db: {
        ...s.db,
        transactions: exists
          ? s.db.transactions.map((t) => (t.id === id ? transaction : t))
          : [...s.db.transactions, transaction],
      },
    };
  });
}

function handleRealtimeBudgetCategoryChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const id = (eventType === "DELETE" ? oldRecord.id : newRecord.id) as string;

  if (eventType === "DELETE" || newRecord?.is_deleted) {
    syncedBudgetCategoryFingerprints.delete(id);
    useStore.setState((s) => ({
      db: {
        ...s.db,
        budgetCategories: s.db.budgetCategories.filter((c) => c.id !== id),
        transactions: s.db.transactions.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null } : t,
        ),
      },
    }));
    return;
  }

  const category = budgetCategoryFromRow(newRecord);
  syncedBudgetCategoryFingerprints.set(
    id,
    localBudgetCategoryFingerprint(category),
  );
  useStore.setState((s) => {
    const exists = s.db.budgetCategories.some((c) => c.id === id);
    return {
      db: {
        ...s.db,
        budgetCategories: exists
          ? s.db.budgetCategories.map((c) => (c.id === id ? category : c))
          : [...s.db.budgetCategories, category],
      },
    };
  });
}
