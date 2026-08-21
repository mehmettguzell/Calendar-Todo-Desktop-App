import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/state/authStore";
import { useStore } from "@/state/store";
import type { Category, FocusSession, Task } from "@/domain/types";

let realtimeChannel: RealtimeChannel | null = null;
let isSyncing = false;
let isStoreSubscribed = false;

/**
 * Initializes cross-device cloud synchronization (Desktop ↔ Mobile).
 */
export function initSyncEngine() {
  // Subscribe to auth state changes to start/stop sync
  useAuthStore.subscribe((state, prevState) => {
    const prevUserId = prevState.user?.id;
    const currentUserId = state.user?.id;

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
      const user = useAuthStore.getState().user;
      if (!supabase || !user || isSyncing) return;

      // 1. Detect added or updated tasks
      const prevMap = new Map(prevState.db.tasks.map((t) => [t.id, t]));
      for (const currentTask of state.db.tasks) {
        const prev = prevMap.get(currentTask.id);
        if (
          !prev ||
          prev.updatedAt !== currentTask.updatedAt ||
          prev.status !== currentTask.status ||
          prev.deletedAt !== currentTask.deletedAt
        ) {
          void syncTaskToCloud(currentTask);
        }
      }

      // 2. Detect added or updated categories
      const prevCatMap = new Map(prevState.db.categories.map((c) => [c.id, c]));
      for (const currentCat of state.db.categories) {
        const prev = prevCatMap.get(currentCat.id);
        if (!prev || prev.name !== currentCat.name || prev.color !== currentCat.color) {
          void syncCategoryToCloud(currentCat);
        }
      }
      for (const prevCat of prevState.db.categories) {
        if (!state.db.categories.some((c) => c.id === prevCat.id)) {
          void syncDeleteCategoryToCloud(prevCat.id);
        }
      }
    });
  }

  // Initial check if already logged in
  const currentUser = useAuthStore.getState().user;
  if (currentUser) {
    void startSync(currentUser.id);
  }
}

async function startSync(userId: string) {
  if (!supabase || isSyncing) return;
  isSyncing = true;

  try {
    // 1. Initial Push: Upload and backup ALL existing local items to Supabase
    await pushLocalData(userId);

    // 2. Initial Pull: Fetch tasks, categories, and focus sessions from Supabase
    await pullCloudData(userId);

    // 3. Setup Realtime Listener for instant updates from other devices (e.g. Mobile)
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

/**
 * Directly syncs a single task to Supabase cloud in real-time.
 */
export async function syncTaskToCloud(task: Task) {
  const user = useAuthStore.getState().user;
  if (!supabase || !user) return;

  try {
    await supabase.from("tasks").upsert(
      {
        id: task.id,
        user_id: user.id,
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
      },
      { onConflict: "id,user_id" },
    );
  } catch (err) {
    console.error("Failed to sync task to cloud:", err);
  }
}

/**
 * Directly marks a task as deleted in Supabase.
 */
export async function syncDeleteTaskToCloud(taskId: string) {
  const user = useAuthStore.getState().user;
  if (!supabase || !user) return;

  try {
    await supabase
      .from("tasks")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .match({ id: taskId, user_id: user.id });
  } catch (err) {
    console.error("Failed to sync delete task to cloud:", err);
  }
}

/**
 * Directly syncs a category to Supabase cloud.
 */
export async function syncCategoryToCloud(cat: Category) {
  const user = useAuthStore.getState().user;
  if (!supabase || !user) return;

  try {
    await supabase.from("categories").upsert(
      {
        id: cat.id,
        user_id: user.id,
        name: cat.name,
        color: cat.color,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id,user_id" },
    );
  } catch (err) {
    console.error("Failed to sync category to cloud:", err);
  }
}

/**
 * Directly marks a category as deleted in Supabase.
 */
export async function syncDeleteCategoryToCloud(catId: string) {
  const user = useAuthStore.getState().user;
  if (!supabase || !user) return;

  try {
    await supabase
      .from("categories")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .match({ id: catId, user_id: user.id });
  } catch (err) {
    console.error("Failed to sync delete category to cloud:", err);
  }
}

/**
 * Fetches all user records from Supabase and merges them into the local store.
 */
async function pullCloudData(userId: string) {
  if (!supabase) return;

  const [tasksRes, catsRes, focusRes] = await Promise.all([
    supabase.from("tasks").select("*").eq("user_id", userId),
    supabase.from("categories").select("*").eq("user_id", userId),
    supabase.from("focus_sessions").select("*").eq("user_id", userId),
  ]);

  if (tasksRes.data && tasksRes.data.length > 0) {
    const cloudTasks: Task[] = tasksRes.data
      .filter((t) => !t.is_deleted)
      .map((t, idx) => ({
        id: t.id,
        title: t.title,
        description: t.description ?? "",
        categoryId: t.category_id,
        parentId: t.parent_id,
        priority: t.priority,
        status: t.status,
        tags: t.tags ?? [],
        dueDate: t.due_date,
        allDay: t.all_day,
        startTime: t.start_time,
        endTime: t.end_time,
        recurrence: t.recurrence,
        snoozedUntil: t.snoozed_until,
        completedAt: t.completed_at,
        deletedAt: null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        order: idx,
      }));

    // Merge into local database
    const localDb = useStore.getState().db;
    const localTaskMap = new Map(localDb.tasks.map((t) => [t.id, t]));

    for (const cTask of cloudTasks) {
      localTaskMap.set(cTask.id, cTask);
    }

    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: Array.from(localTaskMap.values()),
      },
    }));
  }

  if (catsRes.data && catsRes.data.length > 0) {
    const cloudCats: Category[] = catsRes.data
      .filter((c) => !c.is_deleted)
      .map((c, idx) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        order: idx,
      }));

    const localDb = useStore.getState().db;
    const localCatMap = new Map(localDb.categories.map((c) => [c.id, c]));

    for (const cCat of cloudCats) {
      localCatMap.set(cCat.id, cCat);
    }

    useStore.setState((s) => ({
      db: {
        ...s.db,
        categories: Array.from(localCatMap.values()),
      },
    }));
  }

  if (focusRes.data && focusRes.data.length > 0) {
    const cloudFocus: FocusSession[] = focusRes.data.map((f) => ({
      id: f.id,
      taskId: f.task_id,
      occurrenceDate: null,
      startedAt: f.started_at,
      endedAt: null,
      durationSec: f.duration_sec,
    }));

    useStore.setState((s) => ({
      db: {
        ...s.db,
        focusSessions: cloudFocus,
      },
    }));
  }
}

/**
 * Uploads local items to Supabase cloud to preserve all existing user data.
 */
async function pushLocalData(userId: string) {
  if (!supabase) return;
  const localDb = useStore.getState().db;

  if (localDb.tasks.length > 0) {
    const records = localDb.tasks.map((t) => ({
      id: t.id,
      user_id: userId,
      title: t.title,
      description: t.description || null,
      category_id: t.categoryId || null,
      parent_id: t.parentId || null,
      priority: t.priority,
      status: t.status,
      tags: t.tags,
      due_date: t.dueDate || null,
      all_day: t.allDay,
      start_time: t.startTime || null,
      end_time: t.endTime || null,
      recurrence: t.recurrence || null,
      snoozed_until: t.snoozedUntil || null,
      completed_at: t.completedAt || null,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
      is_deleted: t.deletedAt !== null,
    }));

    await supabase.from("tasks").upsert(records, { onConflict: "id,user_id" });
  }

  if (localDb.categories.length > 0) {
    const catRecords = localDb.categories.map((c) => ({
      id: c.id,
      user_id: userId,
      name: c.name,
      color: c.color,
      is_deleted: false,
    }));
    await supabase.from("categories").upsert(catRecords, { onConflict: "id,user_id" });
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
      name: newRecord.name as string,
      color: newRecord.color as string,
      order: 0,
    };

    useStore.setState((s) => {
      const exists = s.db.categories.some((c) => c.id === cat.id);
      return {
        db: {
          ...s.db,
          categories: exists
            ? s.db.categories.map((c) => (c.id === cat.id ? cat : c))
            : [...s.db.categories, cat],
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
