import { useMemo } from "react";
import { create } from "zustand";
import { createRepository } from "@/data/createRepository";
import {
  adoptRepository,
  currentRepository,
  flushPersist,
  openDocumentRepository,
  persist,
  persistNow,
} from "@/data/localDocument";
import {
  deduplicateBudgetCategories,
  deduplicateCategories,
  emptyDatabase,
  pruneTombstones,
  tombstone,
  type Database,
} from "@/data/db";
import {
  ANONYMOUS_NAMESPACE,
  activeNamespace,
  anonymousClaimedBy,
  markAnonymousClaimed,
  namespaceFor,
  setActiveNamespace,
} from "@/data/namespace";
import {
  nowInstant,
  toLocalDate,
} from "@/domain/datetime";
import {
  occurrenceId,
} from "@/domain/ids";
import {
  toInstance,
} from "@/domain/task";
import {
  syncDeleteTaskToCloud,
} from "@/sync/storeBridge";
import type { StoreState } from "./storeState";
import { createMoneySlice } from "./slices/money";
import { createBulkSlice } from "./slices/bulk";
import { createHierarchySlice } from "./slices/hierarchy";
import { createScheduleSlice } from "./slices/schedule";
import { createTaskSlice } from "./slices/tasks";
import { createCategorySlice } from "./slices/categories";
import { createReminderSlice } from "./slices/reminders";
import { createFocusSlice } from "./slices/focus";
import { createDeadlineSlice } from "./slices/deadlines";
import { createWishlistSlice } from "./slices/wishlist";
import type {
  LocalDate,
  Occurrence,
  Settings,
  Task,
  TaskInstance,
} from "@/domain/types";

/**
 * How long a trashed task stays recoverable before it is purged for good.
 *
 * One day, down from three. A trashed row is not free: it is still stored here,
 * still stored in the cloud, and still read by every full sync pass — three
 * days of everything anybody deleted, carried around by every device on the
 * account.
 *
 * A day is the floor rather than an hour because of *how* the mistake is
 * noticed. Deleting the wrong thing is almost never seen at the time — the undo
 * toast covers that minute — it is seen the next time the list is opened, which
 * for a task manager is the next morning. A window that closes overnight would
 * purge exactly the rows somebody was about to come back for; one that lasts
 * until the next visit is the cheapest one that still catches the real mistake.
 */
export const TRASH_RETENTION_MS = 24 * 60 * 60 * 1000;

export const useStore = create<StoreState>((set, get) => {
  /** Every mutation goes through here, so nothing can skip history or persistence. */
  const commit = (mutate: (db: Database) => Database) => {
    set((state) => {
      const db = mutate(state.db);
      persist(db);
      return { db };
    });
  };

  /**
   * Load one namespace's document into the store.
   *
   * Trashed tasks past the retention window are purged here, and each purge
   * leaves a tombstone: without one, the next sync sees a row the cloud still
   * has and this device does not, and helpfully restores it.
   */
  const openNamespace = async (namespace: string): Promise<Database> => {
    const repository = openDocumentRepository(namespace);
    const loaded = await repository.load().catch((error) => {
      console.error("[tempo] load failed", error);
      return null;
    });
    const rawDb = loaded ?? emptyDatabase();
    const lang = rawDb.settings?.language ?? "tr";
    const { categories: cleanCategories, tasks: cleanTasks } =
      deduplicateCategories(rawDb.categories, rawDb.tasks, lang);
    const { budgetCategories: cleanBudgetCategories, transactions: cleanTransactions } =
      deduplicateBudgetCategories(rawDb.budgetCategories ?? [], rawDb.transactions ?? [], lang);
    const nowMs = Date.now();
    const at = new Date(nowMs).toISOString();
    const cutoff = new Date(nowMs - TRASH_RETENTION_MS).toISOString();

    const expired = cleanTasks.filter(
      (t) => t.deletedAt !== null && t.deletedAt < cutoff,
    );
    const validTasks = cleanTasks.filter(
      (t) => t.deletedAt === null || t.deletedAt >= cutoff,
    );

    const db: Database = {
      ...rawDb,
      categories: cleanCategories,
      tasks: validTasks,
      budgetCategories: cleanBudgetCategories,
      transactions: cleanTransactions,
      tombstones: pruneTombstones(
        [
          ...(rawDb.tombstones ?? []),
          ...expired.map((t) => tombstone("task", t.id, at)),
        ],
        new Date(nowMs),
      ),
    };

    set({ db, namespace, ready: true, now: nowMs });
    setActiveNamespace(namespace);
    if (
      !loaded ||
      expired.length > 0 ||
      cleanCategories.length !== rawDb.categories.length ||
      cleanBudgetCategories.length !== (rawDb.budgetCategories?.length ?? 0)
    ) {
      persist(db);
    }
    return db;
  };

  const tools = { set, get, commit };

  return {
    ...createMoneySlice(tools),
    ...createBulkSlice(tools),
    ...createHierarchySlice(tools),
    ...createScheduleSlice(tools),
    ...createTaskSlice(tools),
    ...createCategorySlice(tools),
    ...createReminderSlice(tools),
    ...createFocusSlice(tools),
    ...createDeadlineSlice(tools),
    ...createWishlistSlice(tools),

    ready: false,
    db: emptyDatabase(),
    namespace: ANONYMOUS_NAMESPACE,
    now: Date.now(),
    runningFocus: null,

    async hydrate() {
      await openNamespace(activeNamespace());
    },

    /**
     * Point the store at another account's document.
     *
     * The first account to sign in on a device *adopts* whatever was created
     * while signed out — otherwise trying the app before registering silently
     * throws that work away. Every account after that gets a clean namespace,
     * because handing the same local document to a second person is the exact
     * leak this separation exists to prevent.
     */
    async switchAccount(userId) {
      const target = namespaceFor(userId);
      const open = currentRepository();
      if (open?.namespace === target) return;

      // The document on screen belongs to the namespace we are leaving.
      await flushPersist();

      const previous = open;
      if (
        userId &&
        previous?.namespace === ANONYMOUS_NAMESPACE &&
        anonymousClaimedBy() === null
      ) {
        const carried = get().db;
        const hasWork = carried.tasks.length > 0 || carried.history.length > 0;
        if (hasWork) {
          const incoming = createRepository(target);
          const existing = await incoming.load().catch(() => null);
          if (!existing || existing.tasks.length === 0) {
            adoptRepository(incoming);
            await incoming.save(carried);
            markAnonymousClaimed(userId);
            await previous.clear().catch(() => undefined);
            set({ db: carried, namespace: target });
            setActiveNamespace(target);
            return;
          }
        }
        markAnonymousClaimed(userId);
      }

      set({ ready: false });
      await openNamespace(target);
    },

    tick() {
      const state = get();
      const nowMs = Date.now();
      const cutoff = new Date(nowMs - TRASH_RETENTION_MS).toISOString();

      const toPurge = new Set(
        state.db.tasks
          .filter((t) => t.deletedAt !== null && t.deletedAt < cutoff)
          .map((t) => t.id),
      );

      if (toPurge.size > 0) {
        const at = new Date(nowMs).toISOString();
        commit((db) => ({
          ...db,
          tasks: db.tasks.filter((t) => !toPurge.has(t.id)),
          occurrences: db.occurrences.filter((o) => !toPurge.has(o.taskId)),
          reminders: db.reminders.filter((r) => !toPurge.has(r.taskId)),
          tombstones: pruneTombstones(
            [
              ...db.tombstones,
              ...[...toPurge].map((id) => tombstone("task", id, at)),
            ],
            new Date(nowMs),
          ),
        }));
        for (const id of toPurge) void syncDeleteTaskToCloud(id);
      }

      set({ now: nowMs });
    },
































    /* Bulk ------------------------------------------------------------ */




    /* Budget ---------------------------------------------------------- */























    updateSettings(patch) {
      commit((db) => ({ ...db, settings: { ...db.settings, ...patch } }));
    },

    /**
     * Discard the activity trail.
     *
     * This does not weaken the append-only rule (spec section 5.5): that rule
     * binds the *app*, which may never rewrite or drop an entry as a side
     * effect of rescheduling or completing something. Erasing the trail on an
     * explicit request from the person it belongs to is a different act.
     */
    clearHistory() {
      commit((db) => ({ ...db, history: [] }));
    },

    /** Purge every trashed task at once; the same hard delete as purgeTask. */
    emptyTrash() {
      const trashed = get().db.tasks.filter((t) => t.deletedAt !== null);
      const ids = trashed.map((t) => t.id);
      if (ids.length === 0) return;

      const at = nowInstant();
      commit((db) => {
        const idSet = new Set(ids);
        return {
          ...db,
          tasks: db.tasks.filter((t) => !idSet.has(t.id)),
          occurrences: db.occurrences.filter((o) => !idSet.has(o.taskId)),
          reminders: db.reminders.filter((r) => !idSet.has(r.taskId)),
          tombstones: pruneTombstones([
            ...db.tombstones,
            ...ids.map((id) => tombstone("task", id, at)),
          ]),
        };
      });

      for (const id of ids) {
        void syncDeleteTaskToCloud(id);
      }
    },

    /**
     * Back to a fresh install: tasks, reminders, history and settings all go.
     *
     * Awaited rather than debounced so the caller can report a failed write
     * instead of showing an empty app over a file that still holds everything.
     */
    async resetDatabase() {
      const db = emptyDatabase();
      set({ db, runningFocus: null, now: Date.now() });
      await persistNow(db);
    },
  };
});

/* ------------------------------------------------------------------ */
/* Hooks shared across the UI                                          */
/* ------------------------------------------------------------------ */

/**
 * The shared clock, as a stable object.
 *
 * Identity matters: this `Date` is a dependency of nearly every memo in the
 * app, so it must only change when the minute does.
 */
export function useNow(): Date {
  const now = useStore((s) => s.now);
  return useMemo(() => new Date(now), [now]);
}

export function useSettings(): Settings {
  return useStore((s) => s.db.settings);
}

/** Resolve a task on a date, pulling in its occurrence override when relevant. */
export function instanceFor(
  task: Task,
  occurrences: Map<string, Occurrence>,
  date: LocalDate | null,
  now: Date,
): TaskInstance {
  const key = date ? occurrenceId(task.id, date) : "";
  return toInstance(task, date, occurrences.get(key) ?? null, now);
}

export function todayLocal(now: Date): LocalDate {
  return toLocalDate(now);
}
