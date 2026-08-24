import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { deduplicateCategories, pruneTombstones } from "@/data/db";
import { useAuthStore } from "@/state/authStore";
import { persist, useStore } from "@/state/store";
import { isOnline, useSyncStore } from "@/state/syncStore";
import { formatErrorMessage } from "@/lib/errors";
import type {
  Category,
  FocusSession,
  Occurrence,
  Reminder,
  Task,
  Tombstone,
} from "@/domain/types";
import type { BudgetCategory, Transaction } from "@/domain/money";
import type { HistoryEntry } from "@/domain/types";

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

/** Longest any single request may hold the sync pipeline. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The id every cloud write is keyed by.
 *
 * `user` is the row from `public.profiles` and can legitimately be null for a
 * while (or forever, if the profile fetch failed), so the auth session is the
 * authoritative fallback. Reading only `user` here silently disabled every
 * write whenever the profile lookup did not land.
 */
function currentUserId(): string | null {
  const authState = useAuthStore.getState();
  return authState.user?.id ?? authState.session?.user?.id ?? null;
}

/**
 * Fail a hung request instead of leaving the caller spinning.
 *
 * Supabase requests have no client-side deadline of their own: on a captive
 * portal or a sleeping project they can stay pending for minutes. "Sync with
 * server" must always come back with an answer, even when the answer is that it
 * could not be done.
 */
async function withTimeout<T>(
  work: PromiseLike<T>,
  label: string,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `public.tasks.user_id` has a FK onto `public.profiles`, so a missing profile
 * row makes every task write fail with 23503. The signup trigger normally
 * creates it; accounts that predate the trigger need it backfilled.
 */
async function ensureProfileRow(userId: string): Promise<void> {
  if (!supabase) return;
  const authState = useAuthStore.getState();
  const email = authState.user?.email ?? authState.session?.user?.email ?? "";
  const fullName =
    authState.user?.fullName ??
    (authState.session?.user?.user_metadata?.full_name as string) ??
    email.split("@")[0] ??
    "User";

  // Check if profile row already exists first to avoid 403 RLS violation
  const { data: existing } = await withTimeout(
    supabase.from("profiles").select("id").eq("id", userId).maybeSingle(),
    "profile lookup",
  );

  if (existing) return;

  const { error } = await withTimeout(
    supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    ),
    "profile create",
  );
  if (error) {
    console.warn("[tempo sync] Could not ensure profile row:", error.message);
  }
}

let realtimeChannel: RealtimeChannel | null = null;
let isSyncing = false;
let isApplyingRemoteUpdate = false;
let isStoreSubscribed = false;
let syncedNamespace: string | null = null;

/* ------------------------------------------------------------------ */
/* Optional cloud tables                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether a column or table the schema migration adds is actually present.
 *
 * A user who has not run the latest SQL must still be able to sync everything
 * else, so a missing column downgrades that one feature rather than taking the
 * whole pass down with it.
 */
let hasEndDateColumn: boolean | null = null;
const availableTables = new Map<string, boolean>();

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 undefined_table, PGRST205 unknown relation in the PostgREST cache.
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(error.message ?? "")
  );
}

/** Records that a table is absent so later passes stop asking for it. */
function noteRelationMissing(table: string): void {
  if (availableTables.get(table) !== false) {
    console.info(
      `[tempo sync] public.${table} is not in this project yet — run supabase/schema.sql to sync it.`,
    );
  }
  availableTables.set(table, false);
}

function tableAvailable(table: string): boolean {
  return availableTables.get(table) !== false;
}

/* ------------------------------------------------------------------ */
/* Engine lifecycle                                                    */
/* ------------------------------------------------------------------ */

/**
 * Initializes cross-device cloud synchronization (Desktop ↔ Mobile).
 */
export function initSyncEngine() {
  if (!supabase) {
    useSyncStore.getState().setPhase("disabled");
  }

  // Auth drives everything: which local document is open, and which cloud rows
  // are ours. Both have to move together, or one account briefly sees the
  // other's tasks.
  useAuthStore.subscribe((state, prevState) => {
    const prevUserId = prevState.user?.id ?? prevState.session?.user?.id ?? null;
    const nextUserId = state.user?.id ?? state.session?.user?.id ?? null;
    if (nextUserId === prevUserId) return;

    void handleAccountChange(nextUserId);
  });

  // Watch local Zustand store mutations and automatically sync to Supabase
  if (!isStoreSubscribed) {
    isStoreSubscribed = true;
    useStore.subscribe((state, prevState) => {
      const userId = currentUserId();
      if (!supabase || !userId || isApplyingRemoteUpdate) return;

      // Zustand updates are immutable, so an untouched row keeps its identity:
      // a reference check finds the changed rows without walking their fields.
      queueChangedById(prevState.db.tasks, state.db.tasks, pendingTaskIds);
      queueChangedById(
        prevState.db.categories,
        state.db.categories,
        pendingCategoryIds,
      );
      queueChangedById(
        prevState.db.occurrences,
        state.db.occurrences,
        pendingOccurrenceIds,
      );
      queueChangedById(
        prevState.db.reminders,
        state.db.reminders,
        pendingReminderIds,
      );
      queueChangedById(
        prevState.db.transactions,
        state.db.transactions,
        pendingTransactionIds,
      );
      queueChangedById(
        prevState.db.budgetCategories,
        state.db.budgetCategories,
        pendingBudgetCategoryIds,
      );

      const prevFocusIds = new Set(prevState.db.focusSessions.map((f) => f.id));
      for (const session of state.db.focusSessions) {
        if (!prevFocusIds.has(session.id)) pendingFocusIds.add(session.id);
      }

      // Append-only, so only the new ids are ever interesting.
      if (prevState.db.history !== state.db.history) {
        const prevHistoryIds = new Set(prevState.db.history.map((h) => h.id));
        for (const entry of state.db.history) {
          if (!prevHistoryIds.has(entry.id)) pendingHistoryIds.add(entry.id);
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
    void handleAccountChange(userId);
  }

  watchConnectivity();
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
        pendingTaskIds.delete(stone.id);
        pendingDeletedTaskIds.add(stone.id);
        break;
      case "category":
        // Task categories and budget categories share a tombstone kind but live
        // in different tables. Both queues take the id; whichever table does
        // not have that row simply updates nothing.
        pendingCategoryIds.delete(stone.id);
        pendingDeletedCategoryIds.add(stone.id);
        pendingBudgetCategoryIds.delete(stone.id);
        pendingDeletedBudgetCategoryIds.add(stone.id);
        break;
      case "reminder":
        pendingReminderIds.delete(stone.id);
        pendingDeletedReminderIds.add(stone.id);
        break;
      case "occurrence":
        pendingOccurrenceIds.delete(stone.id);
        pendingDeletedOccurrenceIds.add(stone.id);
        break;
      case "transaction":
        // Transactions are soft-deleted, so the row itself carries the fact and
        // travels as an ordinary update.
        pendingTransactionIds.add(stone.id);
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
async function handleAccountChange(userId: string | null): Promise<void> {
  stopSync();
  forgetSyncedState();
  clearPending();

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
    if (!report.success && report.error && report.error !== "OFFLINE") {
      console.warn("[tempo sync] initial sync failed:", report.error);
    }
  } catch (err) {
    console.error("Cloud sync error:", err);
    useSyncStore.getState().setPhase("error", formatErrorMessage(err));
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
  useSyncStore.getState().setRealtime("down");
}

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 0;

/** Doubling backoff, capped so a long outage still retries a few times an hour. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

function scheduleRetry(): void {
  if (retryTimer || !currentUserId()) return;
  retryDelayMs = retryDelayMs === 0 ? RETRY_BASE_MS : Math.min(retryDelayMs * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (currentUserId() && isOnline()) void syncDifferences();
  }, retryDelayMs);
}

function cancelRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryDelayMs = 0;
}

/**
 * Losing the network is not a reason to sign anybody out.
 *
 * Supabase keeps the session in local storage and refreshes it when it can, so
 * an offline app stays signed in and keeps writing locally. When the connection
 * returns, one reconciliation pass catches the cloud up on everything that
 * happened in the meantime — the queue in memory, plus anything an earlier
 * session left behind, which `syncDifferences` finds by comparing content
 * rather than by trusting a list that a restart would have wiped.
 */
function watchConnectivity(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    cancelRetry();
    const id = currentUserId();
    if (!id) return;
    console.info("[tempo sync] back online — reconciling");
    if (!realtimeChannel) setupRealtime(id);
    void syncDifferences();
  });

  window.addEventListener("offline", () => {
    useSyncStore.getState().setPhase("offline");
    useSyncStore.getState().setRealtime("down");
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const id = currentUserId();
      // Coming back to a window that has been in the background for a while is
      // the cheapest moment to notice a dropped channel.
      if (id && isOnline() && useSyncStore.getState().realtime !== "connected") {
        setupRealtime(id);
        void syncDifferences();
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Fingerprints                                                        */
/* ------------------------------------------------------------------ */

/** Largest number of rows sent to PostgREST in a single request. */
const UPSERT_CHUNK_SIZE = 500;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Collapses the three "empty" spellings that travel between the two stores.
 *
 * The cloud writes `description || null`, PostgREST returns absent columns as
 * `undefined`, and the local store uses `""` and `null` interchangeably. Unless
 * all three normalise to the same value, a task with an empty description looks
 * different on *every* comparison — which is exactly why "sync" reported the
 * user's whole table as changed each time it ran.
 */
function nz(value: unknown): unknown {
  return value === undefined || value === null || value === "" ? null : value;
}

/**
 * `completed_at` is a TIMESTAMPTZ, so Postgres hands it back as
 * `2026-08-22T10:00:00+00:00` while the local store holds
 * `2026-08-22T10:00:00.000Z`. Same instant, different text: compare the
 * instant, never the spelling.
 */
function nzInstant(value: unknown): number | string | null {
  if (value === undefined || value === null || value === "") return null;
  const ms = new Date(value as string).getTime();
  return Number.isNaN(ms) ? String(value) : ms;
}

/** Key order in JSONB round-trips is not guaranteed, so rebuild it explicitly. */
function canonicalRecurrence(value: unknown): string {
  if (!value || typeof value !== "object") return "null";
  const r = value as Record<string, unknown>;
  const byWeekday = Array.isArray(r.byWeekday)
    ? [...(r.byWeekday as number[])].sort((a, b) => a - b)
    : null;
  return JSON.stringify([
    nz(r.freq),
    typeof r.interval === "number" ? r.interval : 1,
    byWeekday && byWeekday.length > 0 ? byWeekday : null,
    nz(r.until),
    r.count ?? null,
  ]);
}

/**
 * A stable digest of every field this engine actually writes to the cloud.
 *
 * Two rows with the same fingerprint are identical as far as sync is
 * concerned, so nothing needs to move in either direction. `created_at` and
 * `updated_at` are deliberately excluded: `updated_at` is the conflict
 * tie-breaker, not part of the content.
 */
function taskFingerprint(fields: unknown[]): string {
  return JSON.stringify(fields);
}

export function localTaskFingerprint(task: Task): string {
  return taskFingerprint([
    nz(task.title),
    nz(task.description),
    nz(task.categoryId),
    nz(task.parentId),
    nz(task.priority),
    nz(task.status),
    (task.tags ?? []).map(String),
    nz(task.dueDate),
    hasEndDateColumn === false ? null : nz(task.endDate),
    Boolean(task.allDay),
    nz(task.startTime),
    nz(task.endTime),
    canonicalRecurrence(task.recurrence),
    task.estimateMinutes ?? null,
    nz(task.snoozedUntil),
    nzInstant(task.completedAt),
    task.deletedAt !== null,
  ]);
}

export function cloudTaskFingerprint(row: Record<string, unknown>): string {
  return taskFingerprint([
    nz(row.title),
    nz(row.description),
    nz(row.category_id),
    nz(row.parent_id),
    nz(row.priority),
    nz(row.status),
    ((row.tags as string[] | null) ?? []).map(String),
    nz(row.due_date),
    hasEndDateColumn === false ? null : nz(row.end_date),
    Boolean(row.all_day),
    nz(row.start_time),
    nz(row.end_time),
    canonicalRecurrence(row.recurrence),
    (row.estimate_minutes as number) ?? null,
    nz(row.snoozed_until),
    nzInstant(row.completed_at),
    Boolean(row.is_deleted),
  ]);
}

function localCategoryFingerprint(cat: Category): string {
  return JSON.stringify([cat.name.trim(), cat.color, false]);
}

function cloudCategoryFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    String(row.name ?? "").trim(),
    row.color,
    Boolean(row.is_deleted),
  ]);
}

function localOccurrenceFingerprint(o: Occurrence): string {
  return JSON.stringify([
    o.taskId,
    o.date,
    o.status,
    nzInstant(o.completedAt),
    nz(o.snoozedUntil),
  ]);
}

function cloudOccurrenceFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.task_id,
    row.date,
    row.status,
    nzInstant(row.completed_at),
    nz(row.snoozed_until),
  ]);
}

function localReminderFingerprint(r: Reminder): string {
  return JSON.stringify([
    r.taskId,
    r.kind,
    r.offsetMinutes ?? null,
    nzInstant(r.remindAt),
    r.status,
    nz(r.snoozedUntil),
    nz(r.lastFiredFor),
  ]);
}

function cloudReminderFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.task_id,
    row.kind,
    row.offset_minutes ?? null,
    nzInstant(row.remind_at),
    row.status,
    nz(row.snoozed_until),
    nz(row.last_fired_for),
  ]);
}

function localTransactionFingerprint(t: Transaction): string {
  return JSON.stringify([
    t.date,
    t.amountMinor,
    t.flow,
    nz(t.categoryId),
    nz(t.note),
    canonicalRecurrence(t.recurrence),
    nz(t.recurrenceSourceId),
    nz(t.lastGeneratedFor),
    nz(t.merchant),
    nz(t.externalId),
    t.deletedAt !== null,
  ]);
}

function cloudTransactionFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.date,
    Math.round(Number(row.amount_minor) || 0),
    row.flow,
    nz(row.category_id),
    nz(row.note),
    canonicalRecurrence(row.recurrence),
    nz(row.recurrence_source_id),
    nz(row.last_generated_for),
    nz(row.merchant),
    nz(row.external_id),
    Boolean(row.is_deleted),
  ]);
}

function localBudgetCategoryFingerprint(c: BudgetCategory): string {
  return JSON.stringify([
    c.name.trim(),
    c.flow,
    c.color,
    c.icon,
    c.builtIn,
    c.monthlyLimitMinor ?? null,
  ]);
}

function cloudBudgetCategoryFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    String(row.name ?? "").trim(),
    row.flow,
    row.color,
    row.icon,
    Boolean(row.built_in),
    (row.monthly_limit_minor as number) ?? null,
  ]);
}

/**
 * What the cloud is believed to already hold, keyed by row id.
 *
 * Every path that learns the cloud's content — a successful upload, a pull, a
 * realtime event — records the fingerprint here. Anything whose fingerprint is
 * unchanged is skipped rather than re-sent, so a store mutation that touches
 * one task costs one row on the wire instead of the whole table.
 */
const syncedTaskFingerprints = new Map<string, string>();
const syncedCategoryFingerprints = new Map<string, string>();
const syncedOccurrenceFingerprints = new Map<string, string>();
const syncedReminderFingerprints = new Map<string, string>();
const syncedTransactionFingerprints = new Map<string, string>();
const syncedBudgetCategoryFingerprints = new Map<string, string>();
const syncedFocusIds = new Set<string>();
/**
 * The activity trail is append-only (spec section 5.5): an entry is never
 * rewritten, so ids alone are the whole diff and no fingerprint is needed.
 */
const syncedHistoryIds = new Set<string>();

function forgetSyncedState() {
  syncedTaskFingerprints.clear();
  syncedCategoryFingerprints.clear();
  syncedOccurrenceFingerprints.clear();
  syncedReminderFingerprints.clear();
  syncedTransactionFingerprints.clear();
  syncedBudgetCategoryFingerprints.clear();
  syncedFocusIds.clear();
  syncedHistoryIds.clear();
}

/* ------------------------------------------------------------------ */
/* Write queue                                                         */
/* ------------------------------------------------------------------ */

/**
 * Local mutations are coalesced instead of fired one request per row.
 *
 * Bulk actions (complete-all, drag reorder, a category rename cascading over
 * its tasks) used to emit one HTTP upsert per affected task. Collecting ids for
 * a short window turns that burst into a single batched upsert — and because a
 * fingerprint check runs before anything is sent, a mutation that did not
 * actually change a synced field costs no request at all.
 */
const FLUSH_DELAY_MS = 600;
const pendingTaskIds = new Set<string>();
const pendingCategoryIds = new Set<string>();
const pendingOccurrenceIds = new Set<string>();
const pendingReminderIds = new Set<string>();
const pendingTransactionIds = new Set<string>();
const pendingBudgetCategoryIds = new Set<string>();
const pendingDeletedTaskIds = new Set<string>();
const pendingDeletedCategoryIds = new Set<string>();
const pendingDeletedOccurrenceIds = new Set<string>();
const pendingDeletedReminderIds = new Set<string>();
const pendingDeletedBudgetCategoryIds = new Set<string>();
const pendingFocusIds = new Set<string>();
const pendingHistoryIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

const ALL_QUEUES = [
  pendingTaskIds,
  pendingCategoryIds,
  pendingOccurrenceIds,
  pendingReminderIds,
  pendingTransactionIds,
  pendingBudgetCategoryIds,
  pendingDeletedTaskIds,
  pendingDeletedCategoryIds,
  pendingDeletedOccurrenceIds,
  pendingDeletedReminderIds,
  pendingDeletedBudgetCategoryIds,
  pendingFocusIds,
  pendingHistoryIds,
];

function pendingCount(): number {
  return ALL_QUEUES.reduce((total, queue) => total + queue.size, 0);
}

function clearPending(): void {
  for (const queue of ALL_QUEUES) queue.clear();
  useSyncStore.getState().setPending(0);
}

function scheduleFlush() {
  useSyncStore.getState().setPending(pendingCount());
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushInFlight = flushPendingWrites().finally(() => {
      flushInFlight = null;
    });
  }, FLUSH_DELAY_MS);
}

/** Lets callers (e.g. a manual sync) wait for queued writes to land first. */
async function drainPendingWrites(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushInFlight = flushPendingWrites().finally(() => {
      flushInFlight = null;
    });
  }
  if (flushInFlight) await flushInFlight;
}

async function flushPendingWrites(): Promise<void> {
  const userId = currentUserId();
  if (!supabase || !userId) {
    clearPending();
    return;
  }
  if (!isOnline()) {
    // Nothing is lost: the ids stay queued and `syncDifferences` would find the
    // same rows by content even if this process never runs again.
    useSyncStore.getState().setPhase("offline");
    return;
  }

  const taskIds = [...pendingTaskIds];
  const deletedTaskIds = [...pendingDeletedTaskIds];
  const categoryIds = [...pendingCategoryIds];
  const deletedCategoryIds = [...pendingDeletedCategoryIds];
  const occurrenceIds = [...pendingOccurrenceIds];
  const deletedOccurrenceIds = [...pendingDeletedOccurrenceIds];
  const reminderIds = [...pendingReminderIds];
  const deletedReminderIds = [...pendingDeletedReminderIds];
  const transactionIds = [...pendingTransactionIds];
  const budgetCategoryIds = [...pendingBudgetCategoryIds];
  const deletedBudgetCategoryIds = [...pendingDeletedBudgetCategoryIds];
  const focusIds = [...pendingFocusIds];
  const historyIds = [...pendingHistoryIds];
  for (const queue of ALL_QUEUES) queue.clear();

  const db = useStore.getState().db;
  const taskById = new Map(db.tasks.map((t) => [t.id, t]));
  const catById = new Map(db.categories.map((c) => [c.id, c]));
  const occById = new Map(db.occurrences.map((o) => [o.id, o]));
  const remById = new Map(db.reminders.map((r) => [r.id, r]));
  const txById = new Map(db.transactions.map((t) => [t.id, t]));
  const budgetCatById = new Map(db.budgetCategories.map((c) => [c.id, c]));

  try {
    // Categories first: a task row's category_id points at one of them.
    const catsToWrite: Category[] = [];
    const catFingerprints = new Map<string, string>();
    for (const id of categoryIds) {
      const cat = catById.get(id);
      if (!cat) continue;
      const fp = localCategoryFingerprint(cat);
      if (syncedCategoryFingerprints.get(id) === fp) continue;
      catsToWrite.push(cat);
      catFingerprints.set(id, fp);
    }
    if (catsToWrite.length > 0) {
      const now = new Date().toISOString();
      for (const batch of chunked(catsToWrite, UPSERT_CHUNK_SIZE)) {
        const { error } = await withTimeout(
          supabase.from("categories").upsert(
            batch.map((c) => ({
              id: c.id,
              user_id: userId,
              name: c.name,
              color: c.color,
              is_deleted: false,
              updated_at: now,
            })),
            { onConflict: "id,user_id" },
          ),
          "category upsert",
        );
        if (error) throw error;
        for (const c of batch) {
          const fp = catFingerprints.get(c.id);
          if (fp) syncedCategoryFingerprints.set(c.id, fp);
        }
      }
    }

    if (deletedCategoryIds.length > 0) {
      const { error } = await withTimeout(
        supabase
          .from("categories")
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .in("id", deletedCategoryIds)
          .eq("user_id", userId),
        "category delete",
      );
      if (error) throw error;
      for (const id of deletedCategoryIds) syncedCategoryFingerprints.delete(id);
    }

    const tasksToWrite: Task[] = [];
    const taskFingerprints = new Map<string, string>();
    const deletedTaskIdSet = new Set(deletedTaskIds);
    for (const id of taskIds) {
      if (deletedTaskIdSet.has(id)) continue;
      const task = taskById.get(id);
      if (!task) continue;
      const fp = localTaskFingerprint(task);
      if (syncedTaskFingerprints.get(id) === fp) continue;
      tasksToWrite.push(task);
      taskFingerprints.set(id, fp);
    }
    if (tasksToWrite.length > 0) {
      const { error } = await upsertTasksToCloud(tasksToWrite, userId);
      if (error) throw error;
      for (const [id, fp] of taskFingerprints) {
        syncedTaskFingerprints.set(id, fp);
      }
    }

    if (deletedTaskIds.length > 0) {
      const { error } = await withTimeout(
        supabase
          .from("tasks")
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .in("id", deletedTaskIds)
          .eq("user_id", userId),
        "task delete",
      );
      if (error) throw error;
      for (const id of deletedTaskIds) syncedTaskFingerprints.delete(id);
    }

    await writeCollection(
      OCCURRENCE_SPEC,
      occurrenceIds
        .map((id) => occById.get(id))
        .filter((o): o is Occurrence => Boolean(o)),
      deletedOccurrenceIds,
      userId,
    );

    await writeCollection(
      REMINDER_SPEC,
      reminderIds
        .map((id) => remById.get(id))
        .filter((r): r is Reminder => Boolean(r)),
      deletedReminderIds,
      userId,
    );

    // Budget categories before transactions: a transaction row points at one.
    await writeCollection(
      BUDGET_CATEGORY_SPEC,
      budgetCategoryIds
        .map((id) => budgetCatById.get(id))
        .filter((c): c is BudgetCategory => Boolean(c)),
      deletedBudgetCategoryIds,
      userId,
    );

    await writeCollection(
      TRANSACTION_SPEC,
      transactionIds
        .map((id) => txById.get(id))
        .filter((t): t is Transaction => Boolean(t)),
      [],
      userId,
    );

    const pendingFocusSet = new Set(focusIds);
    const sessionsToWrite = db.focusSessions.filter(
      (f) => pendingFocusSet.has(f.id) && !syncedFocusIds.has(f.id),
    );
    await writeFocusSessions(sessionsToWrite, userId);

    const pendingHistorySet = new Set(historyIds);
    await writeHistory(
      db.history.filter(
        (h) => pendingHistorySet.has(h.id) && !syncedHistoryIds.has(h.id),
      ),
      userId,
    );

    useSyncStore.getState().setPending(pendingCount());
    if (useSyncStore.getState().phase !== "syncing") {
      useSyncStore.getState().setPhase("idle");
    }
    cancelRetry();
  } catch (err) {
    // Re-queue so the next flush (or a manual sync) retries instead of losing
    // the change. Fingerprints were only committed for rows that succeeded.
    for (const id of taskIds) pendingTaskIds.add(id);
    for (const id of deletedTaskIds) pendingDeletedTaskIds.add(id);
    for (const id of categoryIds) pendingCategoryIds.add(id);
    for (const id of deletedCategoryIds) pendingDeletedCategoryIds.add(id);
    for (const id of occurrenceIds) pendingOccurrenceIds.add(id);
    for (const id of deletedOccurrenceIds) pendingDeletedOccurrenceIds.add(id);
    for (const id of reminderIds) pendingReminderIds.add(id);
    for (const id of deletedReminderIds) pendingDeletedReminderIds.add(id);
    for (const id of transactionIds) pendingTransactionIds.add(id);
    for (const id of budgetCategoryIds) pendingBudgetCategoryIds.add(id);
    for (const id of deletedBudgetCategoryIds) {
      pendingDeletedBudgetCategoryIds.add(id);
    }
    for (const id of focusIds) pendingFocusIds.add(id);
    for (const id of historyIds) pendingHistoryIds.add(id);

    const message = formatErrorMessage(err);
    useSyncStore.getState().setPending(pendingCount());
    useSyncStore.getState().setPhase(isOnline() ? "error" : "offline", message);
    console.warn("[tempo sync] batched write failed:", message);
    scheduleRetry();
  }
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

export function serializeTaskForCloud(
  task: Task,
  userId: string,
  includeEndDate: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: task.id,
    user_id: userId,
    title: task.title,
    description: task.description || null,
    category_id: task.categoryId || null,
    parent_id: task.parentId || null,
    priority: task.priority,
    status: task.status,
    tags: task.tags,
    due_date: task.dueDate || null,
    all_day: task.allDay,
    start_time: task.startTime || null,
    end_time: task.endTime || null,
    recurrence: task.recurrence || null,
    estimate_minutes: task.estimateMinutes ?? null,
    snoozed_until: task.snoozedUntil || null,
    completed_at: task.completedAt || null,
    is_deleted: task.deletedAt !== null,
    created_at: task.createdAt,
    updated_at: task.updatedAt || new Date().toISOString(),
  };

  if (includeEndDate && task.endDate) {
    payload.end_date = task.endDate;
  }

  return payload;
}

export async function upsertTasksToCloud(tasks: Task[], userId: string) {
  if (!supabase || !userId || tasks.length === 0) return { error: null };
  const client = supabase;

  const send = (batch: Task[], includeEndDate: boolean) =>
    withTimeout(
      client
        .from("tasks")
        .upsert(
          batch.map((t) => serializeTaskForCloud(t, userId, includeEndDate)),
          { onConflict: "id,user_id" },
        ),
      "task upsert",
    );

  // PostgREST has a request-size ceiling, so a large first sync must go up in
  // slices rather than as one giant body.
  for (const batch of chunked(tasks, UPSERT_CHUNK_SIZE)) {
    let includeEndDate = hasEndDateColumn !== false;
    let res = await send(batch, includeEndDate);

    if (res.error && res.error.message.includes("end_date")) {
      hasEndDateColumn = false;
      includeEndDate = false;
      res = await send(batch, false);
    } else if (!res.error && includeEndDate) {
      hasEndDateColumn = true;
    }

    if (
      res.error &&
      (res.error.message.includes("profiles") || res.error.code === "23503")
    ) {
      await ensureProfileRow(userId);
      res = await send(batch, includeEndDate);
    }

    if (res.error) return res;
  }

  return { error: null };
}

/**
 * One description of how a collection crosses the wire.
 *
 * Occurrences, reminders, transactions and budget categories all sync the same
 * way — compare by content, resolve by `updated_at`, soft-delete rather than
 * remove. Writing that logic four times is four places for it to drift, so the
 * differences between them live in these tables of functions and the logic
 * lives once.
 */
export interface CollectionSpec<T> {
  table: string;
  idOf(row: T): string;
  localFingerprint(row: T): string;
  cloudFingerprint(row: Record<string, unknown>): string;
  updatedAtOf(row: T): string;
  toCloud(row: T, userId: string): Record<string, unknown>;
  fromCloud(row: Record<string, unknown>): T;
  /** Cloud rows that reference something this device no longer has. */
  isOrphan?(row: Record<string, unknown>, context: SyncContext): boolean;
  /** What the cloud is believed to hold, so unchanged rows are never re-sent. */
  synced: Map<string, string>;
}

export interface SyncContext {
  liveTaskIds: Set<string>;
}

/**
 * Columns added after the first release.
 *
 * A user whose Supabase project still runs the original schema.sql has a
 * `transactions` table without these, and PostgREST rejects the whole batch
 * rather than the unknown key. Rather than making sync fail until they run a
 * migration, the write is retried without the column and the omission is
 * remembered for the rest of the session — the statement importer is a local
 * feature that degrades to "this device knows the merchant, the cloud does
 * not", which is a far better outcome than a red sync badge.
 */
const OPTIONAL_COLUMNS: Record<string, string[]> = {
  transactions: ["merchant", "external_id"],
};

const droppedColumns = new Map<string, Set<string>>();

function withoutMissingColumns(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const gone = droppedColumns.get(table);
  if (!gone || gone.size === 0) return row;
  const copy = { ...row };
  for (const column of gone) delete copy[column];
  return copy;
}

/** Does this error name a column we are allowed to give up on? */
function missingOptionalColumn(table: string, error: unknown): string | null {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (!message) return null;
  for (const column of OPTIONAL_COLUMNS[table] ?? []) {
    if (message.includes(column)) return column;
  }
  return null;
}

async function writeCollection<T>(
  spec: CollectionSpec<T>,
  rows: T[],
  deletedIds: string[],
  userId: string,
): Promise<void> {
  if (!supabase || !tableAvailable(spec.table)) return;

  const toWrite = rows.filter(
    (row) => spec.synced.get(spec.idOf(row)) !== spec.localFingerprint(row),
  );

  for (const batch of chunked(toWrite, UPSERT_CHUNK_SIZE)) {
    const send = () =>
      withTimeout(
        supabase!
          .from(spec.table)
          .upsert(
            batch.map((row) =>
              withoutMissingColumns(spec.table, spec.toCloud(row, userId)),
            ),
            { onConflict: "id,user_id" },
          ),
        `${spec.table} upsert`,
      );

    let { error } = await send();

    const absent = error ? missingOptionalColumn(spec.table, error) : null;
    if (absent) {
      const gone = droppedColumns.get(spec.table) ?? new Set<string>();
      // Give up on every optional column at once: they arrive in the same
      // migration, so a project missing one is missing all of them, and
      // retrying per column would cost a round trip each.
      for (const column of OPTIONAL_COLUMNS[spec.table] ?? []) gone.add(column);
      droppedColumns.set(spec.table, gone);
      ({ error } = await send());
    }

    if (isMissingRelation(error)) {
      noteRelationMissing(spec.table);
      return;
    }
    if (error) throw error;
    for (const row of batch) {
      spec.synced.set(spec.idOf(row), spec.localFingerprint(row));
    }
  }

  if (deletedIds.length > 0) {
    const { error } = await withTimeout(
      supabase
        .from(spec.table)
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in("id", deletedIds)
        .eq("user_id", userId),
      `${spec.table} delete`,
    );
    if (isMissingRelation(error)) {
      noteRelationMissing(spec.table);
      return;
    }
    if (error) throw error;
    for (const id of deletedIds) spec.synced.delete(id);
  }
}

/**
 * Decide what the merged collection should be. Pure — no I/O.
 *
 * Same rule as tasks: compare by content, and when the two sides genuinely
 * differ let the greater `updated_at` win, with ties going to the cloud so
 * every device reaches the same answer.
 *
 * Kept separate from the write so the rule can be tested as a rule, without a
 * network in the way. It is the part most likely to be wrong and hardest to
 * notice when it is.
 */
export function planReconciliation<T>(
  spec: CollectionSpec<T>,
  local: T[],
  cloud: { data: Record<string, unknown>[] | null },
  tombstoned: Set<string>,
  context: SyncContext,
): { merged: T[]; toUpload: T[]; unchanged: boolean } {
  if (!cloud.data) return { merged: local, toUpload: [], unchanged: true };

  const merged = new Map(local.map((row) => [spec.idOf(row), row]));
  const toUpload: T[] = [];
  const cloudById = new Map(cloud.data.map((row) => [row.id as string, row]));

  for (const localRow of local) {
    const id = spec.idOf(localRow);
    const cloudRow = cloudById.get(id);
    if (!cloudRow) {
      toUpload.push(localRow);
      continue;
    }
    if (spec.cloudFingerprint(cloudRow) === spec.localFingerprint(localRow)) continue;

    const cloudWins =
      new Date(cloudRow.updated_at as string).getTime() >=
      new Date(spec.updatedAtOf(localRow)).getTime();
    if (cloudWins) merged.set(id, spec.fromCloud(cloudRow));
    else toUpload.push(localRow);
  }

  for (const cloudRow of cloud.data) {
    const id = cloudRow.id as string;
    if (merged.has(id) || cloudRow.is_deleted || tombstoned.has(id)) continue;
    if (spec.isOrphan?.(cloudRow, context)) continue;
    merged.set(id, spec.fromCloud(cloudRow));
  }

  return { merged: Array.from(merged.values()), toUpload, unchanged: false };
}

/** Apply `planReconciliation`, pushing whatever the local side won. */
async function reconcileCollection<T>(
  spec: CollectionSpec<T>,
  local: T[],
  cloud: { data: Record<string, unknown>[] | null },
  tombstoned: Set<string>,
  context: SyncContext,
  userId: string,
): Promise<T[]> {
  const plan = planReconciliation(spec, local, cloud, tombstoned, context);
  if (plan.unchanged) return local;
  await writeCollection(spec, plan.toUpload, [], userId);
  return plan.merged;
}

/**
 * Per-occurrence state for recurring series.
 *
 * Ticking off Monday's run on the phone has to reach the desktop, and the task
 * row cannot carry that: it holds the rule, not the individual days.
 */
const OCCURRENCE_SPEC: CollectionSpec<Occurrence> = {
  table: "occurrences",
  synced: syncedOccurrenceFingerprints,
  idOf: (o) => o.id,
  updatedAtOf: (o) => o.updatedAt,
  localFingerprint: localOccurrenceFingerprint,
  cloudFingerprint: cloudOccurrenceFingerprint,
  // State about a task that no longer exists here is orphaned bookkeeping.
  isOrphan: (row, ctx) => !ctx.liveTaskIds.has(row.task_id as string),
  toCloud: (o, userId) => ({
    id: o.id,
    user_id: userId,
    task_id: o.taskId,
    date: o.date,
    status: o.status,
    completed_at: o.completedAt,
    snoozed_until: o.snoozedUntil,
    is_deleted: false,
    updated_at: o.updatedAt,
  }),
  fromCloud: occurrenceFromCloud,
};

const REMINDER_SPEC: CollectionSpec<Reminder> = {
  table: "reminders",
  synced: syncedReminderFingerprints,
  idOf: (r) => r.id,
  updatedAtOf: (r) => r.updatedAt,
  localFingerprint: localReminderFingerprint,
  cloudFingerprint: cloudReminderFingerprint,
  isOrphan: (row, ctx) => !ctx.liveTaskIds.has(row.task_id as string),
  toCloud: (r, userId) => ({
    id: r.id,
    user_id: userId,
    task_id: r.taskId,
    kind: r.kind,
    offset_minutes: r.offsetMinutes,
    remind_at: r.remindAt,
    status: r.status,
    snoozed_until: r.snoozedUntil,
    last_fired_for: r.lastFiredFor,
    is_deleted: false,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }),
  fromCloud: reminderFromCloud,
};

const TRANSACTION_SPEC: CollectionSpec<Transaction> = {
  table: "transactions",
  synced: syncedTransactionFingerprints,
  idOf: (t) => t.id,
  updatedAtOf: (t) => t.updatedAt,
  localFingerprint: localTransactionFingerprint,
  cloudFingerprint: cloudTransactionFingerprint,
  toCloud: (t, userId) => ({
    id: t.id,
    user_id: userId,
    date: t.date,
    amount_minor: t.amountMinor,
    flow: t.flow,
    category_id: t.categoryId,
    note: t.note || null,
    recurrence: t.recurrence ?? null,
    recurrence_source_id: t.recurrenceSourceId ?? null,
    last_generated_for: t.lastGeneratedFor ?? null,
    merchant: t.merchant ?? null,
    external_id: t.externalId ?? null,
    is_deleted: t.deletedAt !== null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  }),
  fromCloud: transactionFromCloud,
};

const BUDGET_CATEGORY_SPEC: CollectionSpec<BudgetCategory> = {
  table: "budget_categories",
  synced: syncedBudgetCategoryFingerprints,
  idOf: (c) => c.id,
  updatedAtOf: (c) => c.updatedAt,
  localFingerprint: localBudgetCategoryFingerprint,
  cloudFingerprint: cloudBudgetCategoryFingerprint,
  toCloud: (c, userId) => ({
    id: c.id,
    user_id: userId,
    name: c.name,
    flow: c.flow,
    color: c.color,
    icon: c.icon,
    built_in: c.builtIn,
    sort_order: c.order,
    monthly_limit_minor: c.monthlyLimitMinor ?? null,
    is_deleted: false,
    updated_at: c.updatedAt,
  }),
  fromCloud: budgetCategoryFromCloud,
};

function occurrenceFromCloud(row: Record<string, unknown>): Occurrence {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    date: row.date as string,
    status: (row.status as Occurrence["status"]) ?? "TODO",
    completedAt: (row.completed_at as string) ?? null,
    snoozedUntil: (row.snoozed_until as string) ?? null,
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function reminderFromCloud(row: Record<string, unknown>): Reminder {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    kind: (row.kind as Reminder["kind"]) ?? "RELATIVE",
    offsetMinutes: (row.offset_minutes as number) ?? null,
    remindAt: (row.remind_at as string) ?? null,
    status: (row.status as Reminder["status"]) ?? "PENDING",
    snoozedUntil: (row.snoozed_until as string) ?? null,
    lastFiredFor: (row.last_fired_for as string) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function transactionFromCloud(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    date: row.date as string,
    amountMinor: Math.round(Number(row.amount_minor) || 0),
    flow: (row.flow as Transaction["flow"]) ?? "EXPENSE",
    categoryId: (row.category_id as string) ?? null,
    note: (row.note as string) ?? "",
    recurrence: (row.recurrence as Transaction["recurrence"]) ?? null,
    recurrenceSourceId: (row.recurrence_source_id as string) ?? null,
    lastGeneratedFor: (row.last_generated_for as string) ?? null,
    merchant: (row.merchant as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    deletedAt: row.is_deleted ? ((row.updated_at as string) ?? null) : null,
  };
}

function budgetCategoryFromCloud(row: Record<string, unknown>): BudgetCategory {
  return {
    id: row.id as string,
    name: String(row.name ?? "").trim(),
    flow: (row.flow as BudgetCategory["flow"]) ?? "EXPENSE",
    color: (row.color as string) ?? "#64748b",
    icon: (row.icon as string) ?? "•",
    builtIn: Boolean(row.built_in),
    order: Number(row.sort_order) || 0,
    monthlyLimitMinor: (row.monthly_limit_minor as number) ?? null,
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

/**
 * Append the activity trail.
 *
 * Immutable by contract, so this only ever inserts. Nothing here can conflict,
 * which is why it needs none of the reconciliation the other tables do.
 */
async function writeHistory(
  entries: HistoryEntry[],
  userId: string,
): Promise<void> {
  if (!supabase || entries.length === 0 || !tableAvailable("task_history")) return;

  for (const batch of chunked(entries, UPSERT_CHUNK_SIZE)) {
    const { error } = await withTimeout(
      supabase.from("task_history").upsert(
        batch.map((h) => ({
          id: h.id,
          user_id: userId,
          task_id: h.taskId,
          at: h.at,
          kind: h.kind,
          occurrence_date: h.occurrenceDate,
          field: h.field,
          from_value: h.from,
          to_value: h.to,
          note: h.note,
        })),
        { onConflict: "id,user_id" },
      ),
      "history upsert",
    );
    if (isMissingRelation(error)) {
      noteRelationMissing("task_history");
      return;
    }
    if (error) throw error;
    for (const h of batch) syncedHistoryIds.add(h.id);
  }
}

async function writeFocusSessions(
  sessions: FocusSession[],
  userId: string,
): Promise<void> {
  if (!supabase || sessions.length === 0) return;
  for (const batch of chunked(sessions, UPSERT_CHUNK_SIZE)) {
    const { error } = await withTimeout(
      supabase.from("focus_sessions").upsert(
        batch.map((f) => ({
          id: f.id,
          user_id: userId,
          task_id: f.taskId || null,
          started_at: f.startedAt,
          duration_sec: f.durationSec,
          notes: null,
        })),
        { onConflict: "id,user_id" },
      ),
      "focus upsert",
    );
    if (error) throw error;
    for (const f of batch) syncedFocusIds.add(f.id);
  }
}

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
  if (task.categoryId) pendingCategoryIds.add(task.categoryId);
  pendingTaskIds.add(task.id);
  scheduleFlush();
}

/** Queues a soft delete (`is_deleted = true`) for the next batched write. */
export function syncDeleteTaskToCloud(taskId: string): void {
  if (!supabase || !currentUserId()) return;
  pendingTaskIds.delete(taskId);
  pendingDeletedTaskIds.add(taskId);
  scheduleFlush();
}

/** Queues one category for the next batched cloud write. */
export function syncCategoryToCloud(cat: Category): void {
  if (!supabase || !currentUserId()) return;
  pendingCategoryIds.add(cat.id);
  scheduleFlush();
}

/** Queues a category soft delete for the next batched write. */
export function syncDeleteCategoryToCloud(categoryId: string): void {
  if (!supabase || !currentUserId()) return;
  pendingCategoryIds.delete(categoryId);
  pendingDeletedCategoryIds.add(categoryId);
  scheduleFlush();
}

/** Queues one focus session for the next batched cloud write. */
export function syncFocusSessionToCloud(session: FocusSession): void {
  if (!supabase || !currentUserId()) return;
  pendingFocusIds.add(session.id);
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
  error?: string;
}

function emptyReport(error: string): SyncDifferenceReport {
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
export async function syncDifferences(): Promise<SyncDifferenceReport> {
  if (differencesInFlight) return differencesInFlight;
  differencesInFlight = runSyncDifferences().finally(() => {
    differencesInFlight = null;
  });
  return differencesInFlight;
}

async function runSyncDifferences(): Promise<SyncDifferenceReport> {
  if (!isOnline()) {
    useSyncStore.getState().setPhase("offline");
    return emptyReport("OFFLINE");
  }

  const userId = currentUserId();
  if (!supabase || !userId) {
    useSyncStore.getState().setPhase("disabled");
    return emptyReport("AUTH_REQUIRED");
  }

  useSyncStore.getState().setPhase("syncing");

  // Anything already queued belongs in this pass, not racing alongside it.
  await drainPendingWrites();

  isApplyingRemoteUpdate = true;
  let uploadedTasks = 0;
  let downloadedTasks = 0;
  let uploadedCategories = 0;
  let downloadedCategories = 0;

  try {
    await ensureProfileRow(userId);

    // 1. Fetch all cloud data
    const [
      tasksRes,
      catsRes,
      focusRes,
      occRes,
      remRes,
      txRes,
      budgetCatRes,
      historyRes,
    ] = await Promise.all([
      withTimeout(
        supabase.from("tasks").select("*").eq("user_id", userId),
        "task fetch",
      ),
      withTimeout(
        supabase.from("categories").select("*").eq("user_id", userId),
        "category fetch",
      ),
      withTimeout(
        supabase.from("focus_sessions").select("*").eq("user_id", userId),
        "focus fetch",
      ),
      fetchOptional("occurrences", userId),
      fetchOptional("reminders", userId),
      fetchOptional("transactions", userId),
      fetchOptional("budget_categories", userId),
      fetchOptional("task_history", userId),
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
      if (
        !cloudCat ||
        cloudCategoryFingerprint(cloudCat) !== localCategoryFingerprint(localCat)
      ) {
        catsToUpload.push(localCat);
        uploadedCategories++;
      }
    }

    if (catsToUpload.length > 0) {
      const now = new Date().toISOString();
      for (const batch of chunked(catsToUpload, UPSERT_CHUNK_SIZE)) {
        const { error } = await withTimeout(
          supabase.from("categories").upsert(
            batch.map((c) => ({
              id: c.id,
              user_id: userId,
              name: c.name,
              color: c.color,
              is_deleted: false,
              updated_at: now,
            })),
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
        tasksToUpload.push(localTask);
        uploadedTasks++;
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
        mergedTasks.set(localTask.id, taskFromCloud(cloudTask, localTask.order));
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
      mergedTasks.set(cloudTask.id, taskFromCloud(cloudTask, mergedTasks.size));
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

    /* --- FOCUS SESSIONS ----------------------------------------------- */
    // Immutable once written, so "which ids does the cloud not have" is the
    // whole diff — no field comparison needed.
    const cloudFocusIds = new Set((focusRes.data ?? []).map((f) => f.id));
    await writeFocusSessions(
      localDb.focusSessions.filter((f) => !cloudFocusIds.has(f.id)),
      userId,
    );

    /* --- ACTIVITY TRAIL ----------------------------------------------- */
    // Append-only: the diff is "which ids does each side not have", in both
    // directions, and nothing is ever overwritten.
    let mergedHistory = localDb.history;
    if (historyRes.data) {
      const cloudHistoryIds = new Set(
        historyRes.data.map((h) => h.id as string),
      );
      await writeHistory(
        localDb.history.filter((h) => !cloudHistoryIds.has(h.id)),
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

    let mergedFocus = localDb.focusSessions;
    if (focusRes.data && focusRes.data.length > 0) {
      const focusMap = new Map(localDb.focusSessions.map((f) => [f.id, f]));
      for (const f of focusRes.data) {
        focusMap.set(f.id, {
          id: f.id,
          taskId: f.task_id,
          occurrenceDate: null,
          startedAt: f.started_at,
          endedAt: null,
          durationSec: f.duration_sec,
        });
      }
      mergedFocus = Array.from(focusMap.values());
    }

    /* --- COMMIT ------------------------------------------------------- */
    const nextCategories = deduplicateCategories(mergedCats, nextTasks).categories;
    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: nextTasks,
        categories: nextCategories,
        occurrences: mergedOccurrences,
        reminders: mergedReminders,
        transactions: mergedTransactions,
        budgetCategories: mergedBudgetCategories,
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
      syncedBudgetCategoryFingerprints.set(c.id, localBudgetCategoryFingerprint(c));
    }
    for (const session of mergedFocus) syncedFocusIds.add(session.id);
    for (const entry of mergedHistory) syncedHistoryIds.add(entry.id);

    useSyncStore.getState().markSynced();
    useSyncStore.getState().setPending(pendingCount());
    cancelRetry();

    return {
      success: true,
      uploadedTasks,
      downloadedTasks,
      uploadedCategories,
      downloadedCategories,
      totalDifferences:
        uploadedTasks + downloadedTasks + uploadedCategories + downloadedCategories,
    };
  } catch (err: unknown) {
    const errorMsg = formatErrorMessage(err);
    console.error("syncDifferences failed:", err);
    useSyncStore.getState().setPhase(isOnline() ? "error" : "offline", errorMsg);
    scheduleRetry();
    return {
      success: false,
      uploadedTasks,
      downloadedTasks,
      uploadedCategories,
      downloadedCategories,
      totalDifferences: 0,
      error: errorMsg,
    };
  } finally {
    isApplyingRemoteUpdate = false;
  }
}

/** A select that tolerates the table not existing in this project yet. */
async function fetchOptional(
  table: string,
  userId: string,
): Promise<{ data: Record<string, unknown>[] | null; error: unknown }> {
  if (!supabase || !tableAvailable(table)) return { data: null, error: null };
  const res = await withTimeout(
    supabase.from(table).select("*").eq("user_id", userId),
    `${table} fetch`,
  );
  if (isMissingRelation(res.error)) {
    noteRelationMissing(table);
    return { data: null, error: null };
  }
  return { data: res.data as Record<string, unknown>[] | null, error: res.error };
}

function tombstoneIndex(tombstones: Tombstone[]) {
  const index = {
    task: new Set<string>(),
    category: new Set<string>(),
    reminder: new Set<string>(),
    occurrence: new Set<string>(),
    transaction: new Set<string>(),
  };
  for (const stone of tombstones) index[stone.kind]?.add(stone.id);
  return index;
}

function taskFromCloud(row: Record<string, unknown>, order: number): Task {
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    categoryId: (row.category_id as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    priority: (row.priority as Task["priority"]) ?? "NONE",
    status: (row.status as Task["status"]) ?? "TODO",
    tags: (row.tags as string[]) ?? [],
    dueDate: (row.due_date as string) ?? null,
    endDate: (row.end_date as string) ?? null,
    allDay: Boolean(row.all_day),
    startTime: (row.start_time as string) ?? null,
    endTime: (row.end_time as string) ?? null,
    recurrence: (row.recurrence as Task["recurrence"]) ?? null,
    estimateMinutes: (row.estimate_minutes as number) ?? null,
    snoozedUntil: (row.snoozed_until as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    deletedAt: row.is_deleted ? ((row.updated_at as string) ?? null) : null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    order,
  };
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
    .on("postgres_changes", { event: "*", table: "tasks", ...forUser }, (payload) =>
      applyRemote(() => handleRealtimeTaskChange(payload)),
    )
    .on("postgres_changes", { event: "*", table: "categories", ...forUser }, (payload) =>
      applyRemote(() => handleRealtimeCategoryChange(payload)),
    )
    .on("postgres_changes", { event: "*", table: "occurrences", ...forUser }, (payload) =>
      applyRemote(() => handleRealtimeOccurrenceChange(payload)),
    )
    .on("postgres_changes", { event: "*", table: "reminders", ...forUser }, (payload) =>
      applyRemote(() => handleRealtimeReminderChange(payload)),
    )
    .on("postgres_changes", { event: "*", table: "transactions", ...forUser }, (payload) =>
      applyRemote(() => handleRealtimeTransactionChange(payload)),
    )
    .on(
      "postgres_changes",
      { event: "*", table: "budget_categories", ...forUser },
      (payload) => applyRemote(() => handleRealtimeBudgetCategoryChange(payload)),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        reconnectDelayMs = 0;
        useSyncStore.getState().setRealtime("connected");
        // Whatever happened while we were not listening was never delivered.
        if (syncedNamespace === userId && !isSyncing) void syncDifferences();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
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
  isApplyingRemoteUpdate = true;
  try {
    mutate();
  } finally {
    isApplyingRemoteUpdate = false;
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
    const task = taskFromCloud(newRecord, 0);

    // A soft delete is a state, not a disappearance: keeping the row is what
    // lets Trash show it and Restore undo it on this device too.
    syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));

    useStore.setState((s) => {
      const existing = s.db.tasks.find((t) => t.id === task.id);
      if (!existing) {
        return { db: { ...s.db, tasks: [...s.db.tasks, task] } };
      }
      // The remote row does not know this device's manual ordering.
      const next = { ...task, order: existing.order };
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
            c.id === existing.id ? { ...c, ...cat, id: existing.id, order: c.order } : c,
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

  const occurrence = occurrenceFromCloud(newRecord);
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

  const reminder = reminderFromCloud(newRecord);
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
      db: { ...s.db, transactions: s.db.transactions.filter((t) => t.id !== id) },
    }));
    return;
  }

  // A soft-deleted transaction is kept: the ledger records what happened, and
  // dropping the row would rewrite a past month with nothing to show for it.
  const transaction = transactionFromCloud(newRecord);
  syncedTransactionFingerprints.set(id, localTransactionFingerprint(transaction));
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

  const category = budgetCategoryFromCloud(newRecord);
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
