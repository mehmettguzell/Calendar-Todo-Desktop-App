import { supabase } from "@/lib/supabase";

import {
  classifySyncError,
  formatErrorMessage,
} from "@/lib/errors";

import { currentUserId } from "./account";
import { auth, document, status } from "./ports";
import { watchConnectivity } from "./connectivity";
import { MIN_FULL_SYNC_INTERVAL_MS, forgetLastPass, lastPassAt, syncDifferences } from "./differences";
import { ensureProfileRow } from "./profile";
import { resetPullState } from "./pullCursor";
import { configureRealtime, hasRealtimeChannel, setupRealtime, teardownRealtime } from "./realtime";
import { configureRetry, resetRetryBudget } from "./retry";
import { watchLocalDocument } from "./storeBridge";
import { forgetSyncedState } from "./syncedState";
import { clearPending, drainPendingWrites } from "./writeFlush";

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
    status().setPhase("disabled");
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
  auth().onAccountChange((userId) => {
    void enqueueAccountChange(userId);
  });

  watchLocalDocument();

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

  await document().switchAccount(userId);

  if (!userId) {
    status().setPhase(supabase ? "disabled" : "disabled");
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
    status().setPhase("error", kind);
  } finally {
    isSyncing = false;
  }
}

function stopSync() {
  teardownRealtime();
  isSyncing = false;
  syncedNamespace = null;
  resetPullState();
  status().setRealtime("down");
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

