import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { deduplicateCategories } from "@/data/db";
import { useAuthStore } from "@/state/authStore";
import { persist, useStore } from "@/state/store";
import { formatErrorMessage } from "@/lib/errors";
import type { Category, FocusSession, Task } from "@/domain/types";

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
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.warn("[tempo sync] Could not ensure profile row:", error.message);
  }
}

let realtimeChannel: RealtimeChannel | null = null;
let isSyncing = false;
let isApplyingRemoteUpdate = false;
let isStoreSubscribed = false;

/**
 * Initializes cross-device cloud synchronization (Desktop ↔ Mobile).
 */
export function initSyncEngine() {
  // Subscribe to auth state changes to start/stop sync
  useAuthStore.subscribe((state, prevState) => {
    const prevUserId = prevState.user?.id ?? prevState.session?.user?.id;
    const currentUserId = state.user?.id ?? state.session?.user?.id;

    if (currentUserId && currentUserId !== prevUserId) {
      void startSync(currentUserId);
    } else if (!currentUserId && prevUserId) {
      stopSync();
    }
  });

  // Watch local Zustand store mutations and automatically sync to Supabase
  if (!isStoreSubscribed) {
    isStoreSubscribed = true;
    useStore.subscribe((state, prevState) => {
      const userId = currentUserId();
      if (!supabase || !userId || isApplyingRemoteUpdate) return;

      // Zustand updates are immutable, so an untouched row keeps its identity:
      // a reference check finds the changed rows without walking their fields.
      const prevTaskMap = new Map(prevState.db.tasks.map((t) => [t.id, t]));
      for (const task of state.db.tasks) {
        if (prevTaskMap.get(task.id) !== task) pendingTaskIds.add(task.id);
      }

      const prevCatMap = new Map(prevState.db.categories.map((c) => [c.id, c]));
      for (const cat of state.db.categories) {
        if (prevCatMap.get(cat.id) !== cat) pendingCategoryIds.add(cat.id);
      }
      const currentCatIds = new Set(state.db.categories.map((c) => c.id));
      for (const prevCat of prevState.db.categories) {
        if (!currentCatIds.has(prevCat.id)) {
          pendingCategoryIds.delete(prevCat.id);
          pendingDeletedCategoryIds.add(prevCat.id);
        }
      }

      const prevFocusIds = new Set(prevState.db.focusSessions.map((f) => f.id));
      for (const session of state.db.focusSessions) {
        if (!prevFocusIds.has(session.id)) pendingFocusIds.add(session.id);
      }

      if (
        pendingTaskIds.size > 0 ||
        pendingCategoryIds.size > 0 ||
        pendingDeletedCategoryIds.size > 0 ||
        pendingFocusIds.size > 0
      ) {
        scheduleFlush();
      }
    });
  }

  // Initial check if already logged in
  const userId = currentUserId();
  if (userId) {
    void startSync(userId);
  }

  // Automatic sync when coming back online
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      console.log("[tempo sync] Network back online, checking differences...");
      const id = currentUserId();
      if (id) {
        void syncDifferences();
      }
    });
  }
}

async function startSync(userId: string) {
  if (!supabase || isSyncing) return;
  isSyncing = true;

  try {
    // A fresh session knows nothing about the cloud's contents yet.
    forgetSyncedState();
    await ensureProfileRow(userId);

    // One reconciliation pass covers both directions. The old startup did a
    // blind push of every local row followed by a blind pull of every cloud
    // row, so logging in rewrote the user's entire table twice.
    const report = await syncDifferences();
    if (!report.success && report.error && report.error !== "OFFLINE") {
      console.warn("[tempo sync] initial sync failed:", report.error);
    }

    // Realtime listener for instant updates from other devices (e.g. Mobile)
    setupRealtime(userId);
  } catch (err) {
    console.error("Cloud sync error:", err);
  } finally {
    isSyncing = false;
  }
}

function stopSync() {
  if (realtimeChannel && supabase) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  isSyncing = false;
}

let hasEndDateColumn: boolean | null = null;

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
const syncedFocusIds = new Set<string>();

function forgetSyncedState() {
  syncedTaskFingerprints.clear();
  syncedCategoryFingerprints.clear();
  syncedFocusIds.clear();
}

/**
 * Local mutations are coalesced instead of fired one request per row.
 *
 * Bulk actions (complete-all, drag reorder, a category rename cascading over
 * its tasks) used to emit one HTTP upsert per affected task. Collecting ids for
 * a short window turns that burst into a single batched upsert.
 */
const FLUSH_DELAY_MS = 400;
const pendingTaskIds = new Set<string>();
const pendingCategoryIds = new Set<string>();
const pendingDeletedTaskIds = new Set<string>();
const pendingDeletedCategoryIds = new Set<string>();
const pendingFocusIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

function scheduleFlush() {
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
    pendingTaskIds.clear();
    pendingDeletedTaskIds.clear();
    pendingCategoryIds.clear();
    pendingDeletedCategoryIds.clear();
    pendingFocusIds.clear();
    return;
  }

  const taskIds = [...pendingTaskIds];
  const deletedTaskIds = [...pendingDeletedTaskIds];
  const categoryIds = [...pendingCategoryIds];
  const deletedCategoryIds = [...pendingDeletedCategoryIds];
  const focusIds = [...pendingFocusIds];
  pendingTaskIds.clear();
  pendingDeletedTaskIds.clear();
  pendingCategoryIds.clear();
  pendingDeletedCategoryIds.clear();
  pendingFocusIds.clear();

  const db = useStore.getState().db;
  const taskById = new Map(db.tasks.map((t) => [t.id, t]));
  const catById = new Map(db.categories.map((c) => [c.id, c]));

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
        const { error } = await supabase.from("categories").upsert(
          batch.map((c) => ({
            id: c.id,
            user_id: userId,
            name: c.name,
            color: c.color,
            is_deleted: false,
            updated_at: now,
          })),
          { onConflict: "id,user_id" },
        );
        if (error) throw error;
        for (const c of batch) {
          const fp = catFingerprints.get(c.id);
          if (fp) syncedCategoryFingerprints.set(c.id, fp);
        }
      }
    }

    if (deletedCategoryIds.length > 0) {
      const { error } = await supabase
        .from("categories")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in("id", deletedCategoryIds)
        .eq("user_id", userId);
      if (error) throw error;
      for (const id of deletedCategoryIds) {
        syncedCategoryFingerprints.delete(id);
      }
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
      const { error } = await supabase
        .from("tasks")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in("id", deletedTaskIds)
        .eq("user_id", userId);
      if (error) throw error;
      for (const id of deletedTaskIds) syncedTaskFingerprints.delete(id);
    }

    const pendingFocusSet = new Set(focusIds);
    const sessionsToWrite = db.focusSessions.filter(
      (f) => pendingFocusSet.has(f.id) && !syncedFocusIds.has(f.id),
    );
    if (sessionsToWrite.length > 0) {
      for (const batch of chunked(sessionsToWrite, UPSERT_CHUNK_SIZE)) {
        const { error } = await supabase.from("focus_sessions").upsert(
          batch.map((f) => ({
            id: f.id,
            user_id: userId,
            task_id: f.taskId || null,
            started_at: f.startedAt,
            duration_sec: f.durationSec,
            notes: null,
          })),
          { onConflict: "id,user_id" },
        );
        if (error) throw error;
        for (const f of batch) syncedFocusIds.add(f.id);
      }
    }
  } catch (err) {
    // Re-queue so the next flush (or a manual sync) retries instead of losing
    // the change. Fingerprints were only committed for rows that succeeded.
    for (const id of taskIds) pendingTaskIds.add(id);
    for (const id of deletedTaskIds) pendingDeletedTaskIds.add(id);
    for (const id of categoryIds) pendingCategoryIds.add(id);
    for (const id of deletedCategoryIds) pendingDeletedCategoryIds.add(id);
    for (const id of focusIds) pendingFocusIds.add(id);
    console.warn("[tempo sync] batched write failed:", formatErrorMessage(err));
  }
}

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
    client
      .from("tasks")
      .upsert(
        batch.map((t) => serializeTaskForCloud(t, userId, includeEndDate)),
        { onConflict: "id,user_id" },
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
 * Queues one task for the next batched cloud write.
 *
 * Callers in the store fire this per mutation; the store subscriber queues the
 * same ids independently. Both land in the same set, so an edit that touches
 * ten tasks still costs a single request.
 */
export function syncTaskToCloud(task: Task): void {
  const userId = currentUserId();
  if (!supabase || !userId) return;
  if (task.categoryId) pendingCategoryIds.add(task.categoryId);
  pendingTaskIds.add(task.id);
  scheduleFlush();
}

/** Queues a soft delete (`is_deleted = true`) for the next batched write. */
export function syncDeleteTaskToCloud(taskId: string): void {
  const userId = currentUserId();
  if (!supabase || !userId) return;
  pendingTaskIds.delete(taskId);
  pendingDeletedTaskIds.add(taskId);
  scheduleFlush();
}

/** Queues one category for the next batched cloud write. */
export function syncCategoryToCloud(cat: Category): void {
  const userId = currentUserId();
  if (!supabase || !userId) return;
  pendingCategoryIds.add(cat.id);
  scheduleFlush();
}

/** Queues a category soft delete for the next batched write. */
export function syncDeleteCategoryToCloud(categoryId: string): void {
  const userId = currentUserId();
  if (!supabase || !userId) return;
  pendingCategoryIds.delete(categoryId);
  pendingDeletedCategoryIds.add(categoryId);
  scheduleFlush();
}

/** Queues one focus session for the next batched cloud write. */
export function syncFocusSessionToCloud(session: FocusSession): void {
  const userId = currentUserId();
  if (!supabase || !userId) return;
  pendingFocusIds.add(session.id);
  scheduleFlush();
}

export interface SyncDifferenceReport {
  success: boolean;
  uploadedTasks: number;
  downloadedTasks: number;
  uploadedCategories: number;
  downloadedCategories: number;
  totalDifferences: number;
  error?: string;
}

/**
 * Checks for differences between local store and Supabase cloud DB,
 * and synchronizes all differences bi-directionally with full conflict resolution.
 */
export async function syncDifferences(): Promise<SyncDifferenceReport> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      success: false,
      uploadedTasks: 0,
      downloadedTasks: 0,
      uploadedCategories: 0,
      downloadedCategories: 0,
      totalDifferences: 0,
      error: "OFFLINE",
    };
  }

  const userId = currentUserId();
  if (!supabase || !userId) {
    return {
      success: false,
      uploadedTasks: 0,
      downloadedTasks: 0,
      uploadedCategories: 0,
      downloadedCategories: 0,
      totalDifferences: 0,
      error: "AUTH_REQUIRED",
    };
  }

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
    const [tasksRes, catsRes, focusRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("user_id", userId),
      supabase.from("categories").select("*").eq("user_id", userId),
      supabase.from("focus_sessions").select("*").eq("user_id", userId),
    ]);

    if (tasksRes.error) throw tasksRes.error;
    if (catsRes.error) throw catsRes.error;

    const cloudTasksRaw = tasksRes.data ?? [];
    const cloudCatsRaw = catsRes.data ?? [];

    const localDb = useStore.getState().db;

    // --- CATEGORIES SYNC ---
    const localCatMap = new Map(localDb.categories.map((c) => [c.id, c]));
    const localCatByName = new Map(
      localDb.categories.map((c) => [c.name.trim().toLowerCase(), c]),
    );
    const cloudCatMap = new Map(cloudCatsRaw.map((c) => [c.id, c]));

    const catsToUpload: typeof localDb.categories = [];
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
        const { error } = await supabase.from("categories").upsert(
          batch.map((c) => ({
            id: c.id,
            user_id: userId,
            name: c.name,
            color: c.color,
            is_deleted: false,
            updated_at: now,
          })),
          { onConflict: "id,user_id" },
        );
        if (error) throw error;
      }
    }

    const mergedCats = [...localDb.categories];
    const duplicateCloudCategoryIdsToDelete: string[] = [];

    for (const cloudCat of cloudCatsRaw) {
      if (cloudCat.is_deleted) continue;
      const normalizedName = (cloudCat.name || "").trim().toLowerCase();
      if (!normalizedName) continue;

      // Already present locally, by id or by name.
      if (localCatMap.has(cloudCat.id)) continue;
      if (localCatByName.has(normalizedName)) {
        // Cloud holds a same-named duplicate: retire it there.
        duplicateCloudCategoryIdsToDelete.push(cloudCat.id);
        continue;
      }

      const newCat = {
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

    // --- TASKS SYNC ---
    const localTaskMap = new Map(localDb.tasks.map((t) => [t.id, t]));
    const cloudTaskMap = new Map(cloudTasksRaw.map((t) => [t.id, t]));

    const tasksToUpload: Task[] = [];
    const mergedTasks = new Map<string, Task>(
      localDb.tasks.map((t) => [t.id, t]),
    );

    // Check local tasks against cloud
    for (const localTask of localDb.tasks) {
      const cloudTask = cloudTaskMap.get(localTask.id);
      if (!cloudTask) {
        // Not in cloud: upload!
        tasksToUpload.push(localTask);
        uploadedTasks++;
      } else {
        const cloudUpdatedAt = new Date(cloudTask.updated_at).getTime();
        const localUpdatedAt = new Date(localTask.updatedAt).getTime();

        const isDifferent =
          cloudTaskFingerprint(cloudTask) !== localTaskFingerprint(localTask);

        if (isDifferent) {
          if (localUpdatedAt >= cloudUpdatedAt) {
            // Local is newer: upload
            tasksToUpload.push(localTask);
            uploadedTasks++;
          } else {
            // Cloud is newer: download
            const updatedFromCloud: Task = {
              id: cloudTask.id,
              title: cloudTask.title,
              description: cloudTask.description ?? "",
              categoryId: cloudTask.category_id,
              parentId: cloudTask.parent_id,
              priority: cloudTask.priority,
              status: cloudTask.status,
              tags: cloudTask.tags ?? [],
              dueDate: cloudTask.due_date,
              endDate: cloudTask.end_date ?? null,
              allDay: Boolean(cloudTask.all_day),
              startTime: cloudTask.start_time,
              endTime: cloudTask.end_time,
              recurrence: cloudTask.recurrence,
              snoozedUntil: cloudTask.snoozed_until,
              completedAt: cloudTask.completed_at,
              deletedAt: cloudTask.is_deleted ? cloudTask.updated_at : null,
              createdAt: cloudTask.created_at,
              updatedAt: cloudTask.updated_at,
              order: localTask.order,
            };
            mergedTasks.set(updatedFromCloud.id, updatedFromCloud);
            downloadedTasks++;
          }
        }
      }
    }

    // Check cloud tasks that are not in local at all
    for (const cloudTask of cloudTasksRaw) {
      if (!localTaskMap.has(cloudTask.id)) {
        if (!cloudTask.is_deleted) {
          const newTask: Task = {
            id: cloudTask.id,
            title: cloudTask.title,
            description: cloudTask.description ?? "",
            categoryId: cloudTask.category_id,
            parentId: cloudTask.parent_id,
            priority: cloudTask.priority,
            status: cloudTask.status,
            tags: cloudTask.tags ?? [],
            dueDate: cloudTask.due_date,
            endDate: cloudTask.end_date ?? null,
            allDay: Boolean(cloudTask.all_day),
            startTime: cloudTask.start_time,
            endTime: cloudTask.end_time,
            recurrence: cloudTask.recurrence,
            snoozedUntil: cloudTask.snoozed_until,
            completedAt: cloudTask.completed_at,
            deletedAt: null,
            createdAt: cloudTask.created_at,
            updatedAt: cloudTask.updated_at,
            order: mergedTasks.size,
          };
          mergedTasks.set(newTask.id, newTask);
          downloadedTasks++;
        }
      }
    }

    // Upload differences to cloud
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

    // --- FOCUS SESSIONS ---
    // Immutable once written, so "which ids does the cloud not have" is the
    // whole diff — no field comparison needed.
    const cloudFocusIds = new Set((focusRes.data ?? []).map((f) => f.id));
    const focusToUpload = localDb.focusSessions.filter(
      (f) => !cloudFocusIds.has(f.id),
    );
    for (const batch of chunked(focusToUpload, UPSERT_CHUNK_SIZE)) {
      const { error } = await supabase.from("focus_sessions").upsert(
        batch.map((f) => ({
          id: f.id,
          user_id: userId,
          task_id: f.taskId || null,
          started_at: f.startedAt,
          duration_sec: f.durationSec,
          notes: null,
        })),
        { onConflict: "id,user_id" },
      );
      if (error) throw error;
    }

    // Save all to local Zustand store & disk
    let mergedFocus = localDb.focusSessions;
    if (focusRes.data && focusRes.data.length > 0) {
      const cloudFocus: FocusSession[] = focusRes.data.map((f) => ({
        id: f.id,
        taskId: f.task_id,
        occurrenceDate: null,
        startedAt: f.started_at,
        endedAt: null,
        durationSec: f.duration_sec,
      }));
      const focusMap = new Map(localDb.focusSessions.map((f) => [f.id, f]));
      for (const cf of cloudFocus) {
        focusMap.set(cf.id, cf);
      }
      mergedFocus = Array.from(focusMap.values());
    }

    const nextTasks = Array.from(mergedTasks.values());
    const nextCategories = deduplicateCategories(mergedCats, nextTasks)
      .categories;
    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: nextTasks,
        categories: nextCategories,
        focusSessions: mergedFocus,
      },
    }));
    persist(useStore.getState().db);

    // Both sides are reconciled now, so record the agreed content. The next
    // local edit compares against this and sends only what actually moved.
    syncedTaskFingerprints.clear();
    for (const task of nextTasks) {
      syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));
    }
    syncedCategoryFingerprints.clear();
    for (const cat of nextCategories) {
      syncedCategoryFingerprints.set(cat.id, localCategoryFingerprint(cat));
    }
    syncedFocusIds.clear();
    for (const session of mergedFocus) syncedFocusIds.add(session.id);

    const totalDifferences =
      uploadedTasks +
      downloadedTasks +
      uploadedCategories +
      downloadedCategories;

    return {
      success: true,
      uploadedTasks,
      downloadedTasks,
      uploadedCategories,
      downloadedCategories,
      totalDifferences,
    };
  } catch (err: unknown) {
    const errorMsg = formatErrorMessage(err);
    console.error("syncDifferences failed:", err);
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

/**
 * Listens for realtime WebSocket events from other devices (e.g. mobile app).
 */
function setupRealtime(userId: string) {
  if (!supabase) return;
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase
    .channel(`user-sync-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tasks",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        handleRealtimeTaskChange(payload);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "categories",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        handleRealtimeCategoryChange(payload);
      },
    )
    .subscribe();
}

function handleRealtimeTaskChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    if (newRecord.is_deleted) {
      useStore.setState((s) => ({
        db: {
          ...s.db,
          tasks: s.db.tasks.filter((t) => t.id !== newRecord.id),
        },
      }));
      return;
    }

    const task: Task = {
      id: newRecord.id as string,
      title: newRecord.title as string,
      description: (newRecord.description as string) ?? "",
      categoryId: (newRecord.category_id as string) ?? null,
      parentId: (newRecord.parent_id as string) ?? null,
      priority: (newRecord.priority as Task["priority"]) ?? "NONE",
      status: (newRecord.status as Task["status"]) ?? "TODO",
      tags: (newRecord.tags as string[]) ?? [],
      dueDate: (newRecord.due_date as string) ?? null,
      endDate: (newRecord.end_date as string) ?? null,
      allDay: Boolean(newRecord.all_day),
      startTime: (newRecord.start_time as string) ?? null,
      endTime: (newRecord.end_time as string) ?? null,
      recurrence: (newRecord.recurrence as Task["recurrence"]) ?? null,
      snoozedUntil: (newRecord.snoozed_until as string) ?? null,
      completedAt: (newRecord.completed_at as string) ?? null,
      deletedAt: null,
      createdAt: (newRecord.created_at as string) ?? new Date().toISOString(),
      updatedAt: (newRecord.updated_at as string) ?? new Date().toISOString(),
      order: 0,
    };

    // The cloud is the origin of this row: record it so the store subscriber
    // this setState wakes up does not echo it straight back.
    syncedTaskFingerprints.set(task.id, localTaskFingerprint(task));

    useStore.setState((s) => {
      const exists = s.db.tasks.some((t) => t.id === task.id);
      return {
        db: {
          ...s.db,
          tasks: exists
            ? s.db.tasks.map((t) => (t.id === task.id ? task : t))
            : [...s.db.tasks, task],
        },
      };
    });
  } else if (eventType === "DELETE") {
    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: s.db.tasks.filter((t) => t.id !== oldRecord.id),
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
      useStore.setState((s) => ({
        db: {
          ...s.db,
          categories: s.db.categories.filter((c) => c.id !== newRecord.id),
        },
      }));
      return;
    }

    const cat: Category = {
      id: newRecord.id as string,
      name: (newRecord.name as string).trim(),
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
            c.id === existing.id ? { ...c, ...cat, id: existing.id } : c,
          )
        : [...s.db.categories, cat];
      return {
        db: {
          ...s.db,
          categories: nextCategories,
        },
      };
    });
  } else if (eventType === "DELETE") {
    useStore.setState((s) => ({
      db: {
        ...s.db,
        categories: s.db.categories.filter((c) => c.id !== oldRecord.id),
      },
    }));
  }
}
