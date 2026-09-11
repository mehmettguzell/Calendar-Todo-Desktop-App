import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, FocusSession, HistoryEntry, Task } from "@/domain/types";
import { supabase } from "@/lib/supabase";
import { classifySyncError, type SyncFailureKind } from "@/lib/errors";
import {
  deduplicateBudgetCategories,
  deduplicateCategories,
  pruneTombstones,
} from "@/data/db";
import {
  localBudgetCategoryFingerprint,
  localCategoryFingerprint,
  localDeadlineFingerprint,
  localOccurrenceFingerprint,
  localReminderFingerprint,
  localStatementBatchFingerprint,
  localTaskFingerprint,
  localTransactionFingerprint,
  localWishlistFingerprint,
} from "@/data/dto";
import { document } from "./ports";
import { currentUserId } from "./account";
import {
  fetchCloudSnapshot,
  passScope,
  tombstoneIndex,
  type CloudSnapshot,
  type TombstoneIndex,
} from "./cloudSnapshot";
import { reconcileCollection } from "./cloudWrites";
import {
  BATCH_SPEC,
  BUDGET_CATEGORY_SPEC,
  DEADLINE_SPEC,
  OCCURRENCE_SPEC,
  REMINDER_SPEC,
  TRANSACTION_SPEC,
  WISHLIST_SPEC,
} from "./collectionSpecs";
import { mergeCategories } from "./mergeCategories";
import { mergeTasks } from "./mergeTasks";
import { mergeFocusSessions, mergeHistory } from "./mergeTrail";
import { ensureProfileRow } from "./profile";
import { markFullPassDone, type PullCursor, setPullCursor } from "./pullCursor";
import { pendingCount } from "./queue";
import type { SyncContext } from "./reconcile";
import { beginRemoteApply, endRemoteApply } from "./remoteApply";
import { resetRetryBudget, retriesAllowed, scheduleRetry } from "./retry";
import {
  forgetSyncedState,
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
} from "./syncedState";
import { newestStamp } from "./watermark";
import { drainPendingWrites } from "./writeFlush";
import { status } from "./ports";

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

function report(over: Partial<SyncDifferenceReport>): SyncDifferenceReport {
  return {
    success: false,
    uploadedTasks: 0,
    downloadedTasks: 0,
    uploadedCategories: 0,
    downloadedCategories: 0,
    totalDifferences: 0,
    ...over,
  };
}

const emptyReport = (error: SyncFailureKind) => report({ error });
const unchangedReport = () => report({ success: true });

let differencesInFlight: Promise<SyncDifferenceReport> | null = null;
let lastReport: SyncDifferenceReport | null = null;
let lastReportAt = 0;

/**
 * The floor between two full reconciliations. One pass reads every row of nine
 * tables both ways: the right price once, the wrong price eleven times.
 */
export const MIN_FULL_SYNC_INTERVAL_MS = 60_000;

/** Drops the cached answer, so the next call reads the account again. */
export function forgetLastPass(): void {
  lastReport = null;
  lastReportAt = 0;
}

export function lastPassAt(): number {
  return lastReportAt;
}

/** A press inside the window still flushes edits; only the full read is skipped. */
async function cachedAnswer(): Promise<SyncDifferenceReport> {
  await drainPendingWrites();
  // That flush is the freshest thing that happened, so it decides the answer:
  // "up to date" over a red badge would be the app contradicting itself.
  const failure = status().lastFailure();
  if (failure) return emptyReport(failure);
  return lastReport?.success
    ? unchangedReport()
    : emptyReport(lastReport?.error ?? "unknown");
}

/**
 * Reconcile local and cloud in both directions, by content.
 *
 * The safety net the whole design leans on: no queue, no journal, no memory of
 * what happened while the app was closed. Concurrent callers share one pass.
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
    return emptyReport(status().lastFailure() ?? "unknown");
  }
  if (differencesInFlight) return differencesInFlight;
  if (lastReport && Date.now() - lastReportAt < MIN_FULL_SYNC_INTERVAL_MS) {
    return cachedAnswer();
  }

  // Rebuilt by this pass: a row repaired since the last one must stop counting
  // the moment it goes through.
  status().clearSkipped();

  differencesInFlight = runSyncDifferences()
    .then((result) => {
      lastReport = result;
      lastReportAt = Date.now();
      return result;
    })
    .finally(() => {
      differencesInFlight = null;
    });
  return differencesInFlight;
}

type SpecTables = Awaited<ReturnType<typeof reconcileSpecTables>>;

type MergedDocument = SpecTables & {
  tasks: Task[];
  categories: Category[];
  focusSessions: FocusSession[];
  history: HistoryEntry[];
};

/** The seven tables that reconcile by the shared `CollectionSpec` rules. */
async function reconcileSpecTables(
  snapshot: CloudSnapshot,
  tombstoned: TombstoneIndex,
  context: SyncContext,
  userId: string,
) {
  const db = document().read();
  const none = new Set<string>();
  const of = <T,>(
    spec: Parameters<typeof reconcileCollection<T>>[0],
    local: T[],
    cloud: { data: Record<string, unknown>[] | null },
    tombstones: Set<string>,
  ) => reconcileCollection(spec, local, cloud, tombstones, context, userId);

  return {
    occurrences: await of(OCCURRENCE_SPEC, db.occurrences, snapshot.occurrences, tombstoned.occurrence),
    reminders: await of(REMINDER_SPEC, db.reminders, snapshot.reminders, tombstoned.reminder),
    // Budget categories before transactions: a transaction row points at one.
    budgetCategories: await of(BUDGET_CATEGORY_SPEC, db.budgetCategories, snapshot.budgetCategories, tombstoned.category),
    transactions: await of(TRANSACTION_SPEC, db.transactions, snapshot.transactions, tombstoned.transaction),
    // Wishes and deadlines carry `deletedAt` as an ordinary field, so there are
    // no tombstones to consult and undo can still put one back.
    wishlist: await of(WISHLIST_SPEC, db.wishlist, snapshot.wishlist, none),
    deadlines: await of(DEADLINE_SPEC, db.deadlines, snapshot.deadlines, none),
    statementBatches: await of(BATCH_SPEC, db.statementBatches, snapshot.batches, none),
  };
}

/** Both sides agree now, so the next local edit sends only what actually moved. */
function recordSyncedContent(merged: MergedDocument): void {
  forgetSyncedState();
  const record = <T extends { id: string }>(
    rows: T[],
    into: Map<string, string>,
    fingerprint: (row: T) => string,
  ) => {
    for (const row of rows) into.set(row.id, fingerprint(row));
  };
  record(merged.tasks, syncedTaskFingerprints, localTaskFingerprint);
  record(merged.categories, syncedCategoryFingerprints, localCategoryFingerprint);
  record(merged.occurrences, syncedOccurrenceFingerprints, localOccurrenceFingerprint);
  record(merged.reminders, syncedReminderFingerprints, localReminderFingerprint);
  record(merged.transactions, syncedTransactionFingerprints, localTransactionFingerprint);
  record(merged.budgetCategories, syncedBudgetCategoryFingerprints, localBudgetCategoryFingerprint);
  record(merged.wishlist, syncedWishlistFingerprints, localWishlistFingerprint);
  record(merged.deadlines, syncedDeadlineFingerprints, localDeadlineFingerprint);
  record(merged.statementBatches, syncedBatchFingerprints, localStatementBatchFingerprint);
  for (const session of merged.focusSessions) syncedFocusIds.add(session.id);
  for (const entry of merged.history) syncedHistoryIds.add(entry.id);
}

function commitMergedDocument(merged: MergedDocument): void {
  const lang = document().read().settings?.language ?? "tr";
  const { categories, tasks } = deduplicateCategories(
    merged.categories,
    merged.tasks,
    lang,
  );
  const { budgetCategories, transactions } = deduplicateBudgetCategories(
    merged.budgetCategories,
    merged.transactions,
    lang,
  );
  const settled = { ...merged, tasks, categories, budgetCategories, transactions };

  document().apply((db) => ({ ...db, ...settled, tombstones: pruneTombstones(db.tombstones) }));
  document().flush();
  recordSyncedContent(settled);
}

/**
 * The watermark is the newest timestamp the *server* returned, never this
 * device's clock: a cursor built from local time steps over rows written in the
 * gap between two machines' idea of now.
 */
function advanceCursor(
  snapshot: CloudSnapshot,
  since: PullCursor | null,
  incremental: boolean,
  userId: string,
): void {
  setPullCursor({
    userId,
    tasks: newestStamp(snapshot.tasks, "updated_at", since?.tasks ?? null),
    categories: newestStamp(snapshot.categories, "updated_at", since?.categories ?? null),
    focus: newestStamp(snapshot.focus, "created_at", since?.focus ?? null),
  });
  if (!incremental) markFullPassDone(Date.now());
}

interface ReportCounts {
  uploadedTasks: number;
  downloadedTasks: number;
  uploadedCategories: number;
  downloadedCategories: number;
}

/** Categories before tasks: a task row's category_id points at one of them. */
async function mergeCoreTables(
  client: SupabaseClient,
  userId: string,
  snapshot: CloudSnapshot,
  tombstoned: TombstoneIndex,
  incremental: boolean,
) {
  const db = document().read();
  const categories = await mergeCategories({
    client,
    userId,
    local: db.categories,
    cloud: snapshot.categories,
    tombstoned: tombstoned.category,
    incremental,
  });
  const tasks = await mergeTasks({
    client,
    userId,
    local: document().read().tasks,
    cloud: snapshot.tasks,
    tombstoned: tombstoned.task,
    incremental,
  });
  return { categories, tasks };
}

/** Every table, in the order the foreign keys require. */
async function mergeEverything(
  client: SupabaseClient,
  userId: string,
  snapshot: CloudSnapshot,
  incremental: boolean,
): Promise<{ merged: MergedDocument; counts: ReportCounts }> {
  const tombstoned = tombstoneIndex(document().read().tombstones);
  const { categories, tasks } = await mergeCoreTables(
    client,
    userId,
    snapshot,
    tombstoned,
    incremental,
  );

  const context: SyncContext = {
    liveTaskIds: new Set(tasks.merged.map((t) => t.id)),
  };
  const collections = await reconcileSpecTables(snapshot, tombstoned, context, userId);
  const focusSessions = await mergeFocusSessions({
    client,
    userId,
    local: document().read().focusSessions,
    cloud: snapshot.focus,
    tombstoned: tombstoned.focus,
    incremental,
  });
  const history = await mergeHistory(
    document().read().history,
    snapshot.history,
    userId,
  );

  return {
    merged: {
      ...collections,
      tasks: tasks.merged,
      categories: categories.merged,
      focusSessions,
      history,
    },
    counts: {
      uploadedTasks: tasks.uploaded,
      downloadedTasks: tasks.downloaded,
      uploadedCategories: categories.uploaded,
      downloadedCategories: categories.downloaded,
    },
  };
}

async function reconcileEverything(
  client: SupabaseClient,
  userId: string,
): Promise<SyncDifferenceReport> {
  // Anything already queued belongs in this pass, not racing alongside it.
  await drainPendingWrites();
  await ensureProfileRow(userId);

  const { incremental, since } = passScope(userId);
  const snapshot = await fetchCloudSnapshot(client, userId, since);
  const pass = await mergeEverything(client, userId, snapshot, incremental);

  commitMergedDocument(pass.merged);
  advanceCursor(snapshot, since, incremental, userId);

  status().markSynced();
  status().setPending(pendingCount());
  resetRetryBudget();

  const { counts } = pass;
  return report({
    success: true,
    ...counts,
    totalDifferences:
      counts.uploadedTasks +
      counts.downloadedTasks +
      counts.uploadedCategories +
      counts.downloadedCategories,
  });
}

async function runSyncDifferences(): Promise<SyncDifferenceReport> {
  if (!status().isOnline()) {
    status().setPhase("offline");
    return emptyReport("offline");
  }
  const userId = currentUserId();
  if (!supabase || !userId) {
    status().setPhase("disabled");
    return emptyReport("auth");
  }

  status().setPhase("syncing");
  beginRemoteApply();
  try {
    return await reconcileEverything(supabase, userId);
  } catch (err: unknown) {
    const kind = classifySyncError(err);
    console.error(`[tempo sync] reconciliation failed (${kind}):`, err);
    status().setPhase(status().isOnline() ? "error" : "offline", kind);
    scheduleRetry(kind);
    return emptyReport(kind);
  } finally {
    endRemoteApply();
    // A pass may only end in a phase the user can act on: if something escaped
    // both the try and the catch, "syncing" would stay on screen forever.
    if (status().currentPhase() === "syncing") {
      status().setPhase(status().isOnline() ? "error" : "offline", "unknown");
    }
  }
}
