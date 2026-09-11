import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Task } from "@/domain/types";
import { supabase } from "@/lib/supabase";
import { classifySyncError, formatErrorMessage } from "@/lib/errors";
import { localCategoryFingerprint, localTaskFingerprint, toCategoryRow } from "@/data/dto";
import type { Database } from "@/data/db";
import { currentUserId } from "./account";
import { document } from "./ports";
import { withTimeout } from "./cloudRequest";
import {
  BUDGET_CATEGORY_SPEC,
  OCCURRENCE_SPEC,
  REMINDER_SPEC,
  TRANSACTION_SPEC,
} from "./collectionSpecs";
import {
  chunked,
  UPSERT_CHUNK_SIZE,
  upsertTasksToCloud,
  writeCollection,
  writeFocusSessions,
  writeHistory,
} from "./cloudWrites";
import { flushDelayMs } from "./flushSchedule";
import {
  clearAllQueues,
  drainQueues,
  pendingCount,
  type QueueSnapshot,
  requeue,
} from "./queue";
import { resetRetryBudget, retriesAllowed, scheduleRetry } from "./retry";
import {
  syncedCategoryFingerprints,
  syncedFocusIds,
  syncedHistoryIds,
  syncedTaskFingerprints,
} from "./syncedState";
import { planTaskWrites } from "./writePlan";
import { status } from "./ports";

/**
 * Local mutations are coalesced instead of fired one request per row.
 *
 * Bulk actions (complete-all, drag reorder, a category rename cascading over
 * its tasks) used to emit one HTTP upsert per affected task. Collecting ids for
 * a short window turns that burst into a single batched upsert — and because a
 * fingerprint check runs before anything is sent, a mutation that did not
 * actually change a synced field costs no request at all.
 *
 * How long the window gathers — the trailing delay and the ceiling that a
 * stream of edits cannot push past — is `flushDelayMs` in `@/sync`.
 */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** When the oldest un-flushed change was queued; drives the ceiling above. */
let queuedSince: number | null = null;
let flushInFlight: Promise<void> | null = null;

export function clearPending(): void {
  clearAllQueues();
  status().setPending(0);
}

/**
 * Send the queue once the edits stop, not once they start.
 *
 * The timer used to be set by the first change and left alone, so a burst of
 * editing fired a request five seconds in — mid-sentence, with more of the same
 * field still to come, and every keystroke after it queued for a second round.
 * Restarting it on each change means one request per edit rather than one per
 * five seconds of thinking, and `FLUSH_MAX_WAIT_MS` keeps a long stream from
 * postponing the write forever.
 */
export function scheduleFlush() {
  status().setPending(pendingCount());

  const now = Date.now();
  if (queuedSince === null) queuedSince = now;

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(
    () => {
      flushTimer = null;
      queuedSince = null;
      flushInFlight = flushPendingWrites().finally(() => {
        flushInFlight = null;
      });
    },
    flushDelayMs({
      now,
      queuedSince,
      undoOfferExpiresAt: document().undoOfferExpiresAt(),
    }),
  );
}

/** Lets callers (e.g. a manual sync) wait for queued writes to land first. */
export async function drainPendingWrites(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    queuedSince = null;
    flushInFlight = flushPendingWrites().finally(() => {
      flushInFlight = null;
    });
  }
  if (flushInFlight) await flushInFlight;
}

type LocalDb = Database;

async function writeQueuedCategories(
  client: SupabaseClient,
  queued: QueueSnapshot,
  catById: Map<string, Category>,
  userId: string,
): Promise<void> {
  const toWrite: Category[] = [];
  const fingerprints = new Map<string, string>();
  for (const id of queued.categories) {
    const cat = catById.get(id);
    if (!cat) continue;
    const fp = localCategoryFingerprint(cat);
    if (syncedCategoryFingerprints.get(id) === fp) continue;
    toWrite.push(cat);
    fingerprints.set(id, fp);
  }

  const now = new Date().toISOString();
  for (const batch of chunked(toWrite, UPSERT_CHUNK_SIZE)) {
    const { error } = await withTimeout(
      client.from("categories").upsert(
        batch.map((c) => toCategoryRow(c, userId, now)),
        { onConflict: "id,user_id" },
      ),
      "category upsert",
    );
    if (error) throw error;
    for (const c of batch) {
      const fp = fingerprints.get(c.id);
      if (fp) syncedCategoryFingerprints.set(c.id, fp);
    }
  }

  if (queued.deletedCategories.length === 0) return;
  const { error } = await withTimeout(
    client
      .from("categories")
      .update({ is_deleted: true, updated_at: now })
      .in("id", queued.deletedCategories)
      .eq("user_id", userId),
    "category delete",
  );
  if (error) throw error;
  for (const id of queued.deletedCategories) {
    syncedCategoryFingerprints.delete(id);
  }
}

/** Returns the plan, because the activity trail needs to know what it forgot. */
async function writeQueuedTasks(
  client: SupabaseClient,
  queued: QueueSnapshot,
  taskById: Map<string, Task>,
  userId: string,
): Promise<ReturnType<typeof planTaskWrites>> {
  const plan = planTaskWrites({
    queued: queued.tasks,
    deleted: queued.deletedTasks,
    taskById,
    synced: syncedTaskFingerprints,
  });

  if (plan.upsert.length > 0) {
    const tasks = plan.upsert
      .map((id) => taskById.get(id))
      .filter((t): t is Task => Boolean(t));
    const { error } = await upsertTasksToCloud(tasks, userId);
    if (error) throw error;
    for (const task of tasks) {
      syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));
    }
  }

  if (plan.markDeleted.length > 0) {
    const { error } = await withTimeout(
      client
        .from("tasks")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in("id", plan.markDeleted)
        .eq("user_id", userId),
      "task delete",
    );
    if (error) throw error;
  }
  for (const id of queued.deletedTasks) syncedTaskFingerprints.delete(id);
  return plan;
}

function present<T>(ids: string[], byId: Map<string, T>): T[] {
  return ids.map((id) => byId.get(id)).filter((row): row is T => Boolean(row));
}

async function writeQueuedCollections(
  queued: QueueSnapshot,
  db: LocalDb,
  userId: string,
): Promise<void> {
  const occById = new Map(db.occurrences.map((o) => [o.id, o]));
  const remById = new Map(db.reminders.map((r) => [r.id, r]));
  const budgetCatById = new Map(db.budgetCategories.map((c) => [c.id, c]));
  const txById = new Map(db.transactions.map((t) => [t.id, t]));

  await writeCollection(
    OCCURRENCE_SPEC,
    present(queued.occurrences, occById),
    queued.deletedOccurrences,
    userId,
  );
  await writeCollection(
    REMINDER_SPEC,
    present(queued.reminders, remById),
    queued.deletedReminders,
    userId,
  );
  // Budget categories before transactions: a transaction row points at one.
  await writeCollection(
    BUDGET_CATEGORY_SPEC,
    present(queued.budgetCategories, budgetCatById),
    queued.deletedBudgetCategories,
    userId,
  );
  await writeCollection(
    TRANSACTION_SPEC,
    present(queued.transactions, txById),
    [],
    userId,
  );
}

async function writeQueuedTrail(
  queued: QueueSnapshot,
  db: LocalDb,
  forgottenTaskIds: Set<string>,
  userId: string,
): Promise<void> {
  const focusQueued = new Set(queued.focus);
  await writeFocusSessions(
    db.focusSessions.filter(
      (f) => focusQueued.has(f.id) && !syncedFocusIds.has(f.id),
    ),
    userId,
  );

  const historyQueued = new Set(queued.history);
  await writeHistory(
    db.history.filter(
      (h) =>
        historyQueued.has(h.id) &&
        !syncedHistoryIds.has(h.id) &&
        // The trail of a task created and trashed before it ever reached the
        // cloud describes a row nothing over there has.
        !forgottenTaskIds.has(h.taskId),
    ),
    userId,
  );
}

/** Everything the queue holds, in the order the foreign keys require. */
async function sendQueuedWrites(
  client: SupabaseClient,
  queued: QueueSnapshot,
  userId: string,
): Promise<void> {
  const db = document().read();
  // Categories first: a task row's category_id points at one of them.
  await writeQueuedCategories(
    client,
    queued,
    new Map(db.categories.map((c) => [c.id, c])),
    userId,
  );
  const plan = await writeQueuedTasks(
    client,
    queued,
    new Map(db.tasks.map((t) => [t.id, t])),
    userId,
  );
  await writeQueuedCollections(queued, db, userId);
  await writeQueuedTrail(queued, db, plan.forget, userId);
}

// Re-queue so the next flush retries instead of losing the change; fingerprints
// were only committed for the rows that actually landed.
function reportWriteFailure(err: unknown, queued: QueueSnapshot): void {
  requeue(queued);
  const kind = classifySyncError(err);
  status().setPending(pendingCount());
  status().setPhase(status().isOnline() ? "error" : "offline", kind);
  // Full detail to the console only: the message can name tables, columns and
  // constraints, which is not the user's business.
  console.warn(
    `[tempo sync] batched write failed (${kind}):`,
    formatErrorMessage(err),
  );
  scheduleRetry(kind);
}

export async function flushPendingWrites(): Promise<void> {
  const userId = currentUserId();
  if (!supabase || !userId) {
    clearPending();
    return;
  }
  if (!status().isOnline()) {
    // Nothing is lost: the ids stay queued and `syncDifferences` would find the
    // same rows by content even if this process never runs again.
    status().setPhase("offline");
    return;
  }
  // Same reasoning while the retry budget is spent: keep editing, keep queuing,
  // just stop calling a server that has said no four times in a row.
  if (!retriesAllowed()) {
    status().setPending(pendingCount());
    return;
  }

  const queued = drainQueues();
  try {
    await sendQueuedWrites(supabase, queued, userId);
    status().setPending(pendingCount());
    if (status().currentPhase() !== "syncing") {
      status().setPhase("idle");
    }
    resetRetryBudget();
  } catch (err) {
    reportWriteFailure(err, queued);
  }
}
