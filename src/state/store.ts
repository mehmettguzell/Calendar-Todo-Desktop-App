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
import { historyEntry } from "@/domain/history";
import { pinOf } from "@/domain/manualOrder";
import { createId, occurrenceId } from "@/domain/ids";
import {
  copySubtree,
} from "@/domain/copy";
import {
  representativeInstance,
  toInstance,
} from "@/domain/task";
import {
  resolveSnooze,
} from "@/domain/snooze";
import { NOTE_TAG } from "@/domain/note";
import {
  syncDeleteTaskToCloud,
  syncTaskToCloud,
} from "@/sync/storeBridge";
import { fireConfetti } from "@/lib/confetti";
import { useUndoStore } from "./undoStore";
import type { StoreState } from "./storeState";
import { createMoneySlice } from "./slices/money";
import { createCategorySlice } from "./slices/categories";
import { createReminderSlice } from "./slices/reminders";
import { createFocusSlice } from "./slices/focus";
import { createDeadlineSlice } from "./slices/deadlines";
import { createWishlistSlice } from "./slices/wishlist";
import type {
  TaskPatch,
} from "./storeTypes";
import {
  appendHistory,
  applyStatus,
  collectSubtree,
  describeSchedule,
  openDescendants,
  refOf,
  serialise,
  shiftedEnd,
  shiftedEndTime,
  syncSubtree,
  writeSnoozeUntil,
} from "./taskMutations";
import type {
  HistoryEntry,
  InstanceRef,
  LocalDate,
  Occurrence,
  Settings,
  StoredStatus,
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

    createTask(draft) {
      const at = nowInstant();
      const siblings = get().db.tasks.filter(
        (t) => t.parentId === (draft.parentId ?? null),
      );
      const parent = draft.parentId
        ? (get().db.tasks.find((t) => t.id === draft.parentId) ?? null)
        : null;
      const task: Task = {
        id: createId("t"),
        title: draft.title.trim(),
        description: draft.description ?? "",
        status: "TODO",
        // How urgent a step is, is how urgent the thing it is a step of is —
        // until somebody says otherwise. Steps are added from a one-line box
        // with no priority field on it, so they were all born NONE: put on
        // today, a step of an urgent plan arrived in the list looking like the
        // least pressing thing on it, and there was nowhere in the flow that
        // added the step to say different.
        priority: draft.priority ?? parent?.priority ?? "NONE",
        dueDate: draft.dueDate ?? null,
        endDate: draft.endDate ?? null,
        deadline: draft.deadline ?? null,
        allDay: draft.allDay ?? true,
        startTime: draft.startTime ?? null,
        endTime: draft.endTime ?? null,
        // A subtask belongs to whatever its parent belongs to, unless the
        // caller says otherwise. Filing a step under "Tez" and then having to
        // pick the category again is asking for the same fact twice.
        categoryId: draft.categoryId ?? parent?.categoryId ?? null,
        tags: draft.tags ?? [],
        parentId: draft.parentId ?? null,
        recurrence: draft.recurrence ?? null,
        estimateMinutes: draft.estimateMinutes ?? null,
        snoozedUntil: null,
        order: siblings.length,
        manualOrder: null,
        createdAt: at,
        updatedAt: at,
        completedAt: null,
        deletedAt: null,
      };

      commit((db) =>
        appendHistory(
          { ...db, tasks: [...db.tasks, task] },
          historyEntry({
            taskId: task.id,
            kind: "CREATED",
            note: `Created "${task.title}"`,
          }),
        ),
      );
      void syncTaskToCloud(task);
      return task;
    },

    /**
     * Copy a task onto another day.
     *
     * The copy is a new, independent task (see `domain/copy.ts`): it starts at
     * TODO, carries the subtasks that make it meaningful, and leaves the
     * original's reminders, focus sessions and history behind — those are the
     * record of what happened to *that* task, and a copy has no past yet.
     */
    duplicateTask(taskId, target = {}) {
      const at = nowInstant();
      const source = get().db.tasks.find(
        (t) => t.id === taskId && t.deletedAt === null,
      );
      if (!source) return null;

      const copies = copySubtree(get().db.tasks, taskId, target, at);
      const root = copies[0];
      if (!root) return null;

      // The copy sorts after everything already on its day rather than
      // inheriting the source's position and landing on top of a stranger.
      const siblings = get().db.tasks.filter(
        (t) => t.parentId === root.parentId,
      );
      root.order = siblings.length;

      commit((db) =>
        appendHistory(
          { ...db, tasks: [...db.tasks, ...copies] },
          ...copies.map((copy) =>
            historyEntry({
              taskId: copy.id,
              kind: "CREATED",
              note:
                copy.id === root.id
                  ? `Copied from "${source.title}"`
                  : `Copied with "${source.title}"`,
            }),
          ),
        ),
      );
      for (const copy of copies) void syncTaskToCloud(copy);

      // A stray copy on the wrong day is the whole risk of a one-key paste.
      useUndoStore
        .getState()
        .push("undoneTaskCopied", () => get().purgeTask(root.id));

      return root;
    },

    updateTask(taskId, patch, note) {
      commit((db) => {
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) return db;

        const entries: HistoryEntry[] = [];
        const scheduleChanged =
          ("dueDate" in patch && patch.dueDate !== task.dueDate) ||
          ("endDate" in patch && patch.endDate !== task.endDate) ||
          ("startTime" in patch && patch.startTime !== task.startTime) ||
          ("endTime" in patch && patch.endTime !== task.endTime) ||
          ("allDay" in patch && patch.allDay !== task.allDay);

        if (scheduleChanged) {
          entries.push(
            historyEntry({
              taskId,
              kind: "RESCHEDULED",
              field: "schedule",
              from: describeSchedule(task),
              to: describeSchedule({ ...task, ...patch }),
            }),
          );
        }

        const tracked = [
          "title",
          "description",
          "priority",
          "categoryId",
          "recurrence",
          "estimateMinutes",
          "tags",
          // Not folded into `scheduleChanged` above: moving a task is not the
          // same act as changing what it has to be finished by, and §5 asks
          // for the history to keep both rather than one summary of the two.
          "deadline",
        ] as const;
        for (const field of tracked) {
          if (!(field in patch)) continue;
          const before = serialise(task[field]);
          const after = serialise(patch[field]);
          if (before === after) continue;
          entries.push(
            historyEntry({
              taskId,
              kind: "UPDATED",
              field,
              from: before,
              to: after,
            }),
          );
        }
        if (note) entries.push(historyEntry({ taskId, kind: "UPDATED", note }));

        const at = nowInstant();
        const next = { ...task, ...patch, updatedAt: at };

        /*
         * A subtask sits in its parent's category, so re-filing a plan re-files
         * its steps. Only tasks that actually disagree are touched, which keeps
         * this a no-op for every other edit and stops it from churning
         * `updatedAt` — and therefore the sync — on a whole subtree.
         */
        const cascade =
          "categoryId" in patch && patch.categoryId !== task.categoryId
            ? new Set(
                collectSubtree(db.tasks, taskId).filter(
                  (id) =>
                    id !== taskId &&
                    db.tasks.find((t) => t.id === id)?.categoryId !== next.categoryId,
                ),
              )
            : new Set<string>();

        for (const id of cascade) {
          entries.push(
            historyEntry({
              taskId: id,
              kind: "UPDATED",
              field: "categoryId",
              from: serialise(db.tasks.find((t) => t.id === id)?.categoryId ?? null),
              to: serialise(next.categoryId ?? null),
            }),
          );
        }

        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              t.id === taskId
                ? next
                : cascade.has(t.id)
                  ? { ...t, categoryId: next.categoryId ?? null, updatedAt: at }
                  : t,
            ),
          },
          ...entries,
        );
      });
      if ("categoryId" in patch) {
        syncSubtree(get().db, taskId);
      } else {
        const updated = get().db.tasks.find((t) => t.id === taskId);
        if (updated) void syncTaskToCloud(updated);
      }
    },

    deleteTask(taskId) {
      commit((db) => {
        const at = nowInstant();
        const ids = collectSubtree(db.tasks, taskId);
        const entries = ids.map((id) =>
          historyEntry({ taskId: id, kind: "DELETED", note: "Moved to trash" }),
        );
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              ids.includes(t.id) ? { ...t, deletedAt: at, updatedAt: at } : t,
            ),
          },
          ...entries,
        );
      });
      // The whole subtree was trashed, so the whole subtree has to travel:
      // queueing only the root left the children alive in the cloud, and the
      // next device to look saw half a deleted task.
      syncSubtree(get().db, taskId);

      // The reversal is the ordinary restore, so the trail records both the
      // delete and the undo rather than quietly rewinding to before either.
      useUndoStore
        .getState()
        .push("undoneTaskDeleted", () => get().restoreTask(taskId));
    },

    restoreTask(taskId) {
      commit((db) => {
        const ids = collectSubtree(db.tasks, taskId);
        const at = nowInstant();
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              ids.includes(t.id) ? { ...t, deletedAt: null, updatedAt: at } : t,
            ),
          },
          ...ids.map((id) => historyEntry({ taskId: id, kind: "RESTORED" })),
        );
      });
      syncSubtree(get().db, taskId);
    },

    /** Hard delete. History rows survive: they are the record that it existed. */
    purgeTask(taskId) {
      const purged = collectSubtree(get().db.tasks, taskId);
      const at = nowInstant();
      commit((db) => {
        const ids = new Set(purged);
        return {
          ...db,
          tasks: db.tasks.filter((t) => !ids.has(t.id)),
          occurrences: db.occurrences.filter((o) => !ids.has(o.taskId)),
          reminders: db.reminders.filter((r) => !ids.has(r.taskId)),
          tombstones: pruneTombstones([
            ...db.tombstones,
            ...purged.map((id) => tombstone("task", id, at)),
          ]),
        };
      });
      // The whole subtree went, not just the row that was clicked.
      for (const id of purged) void syncDeleteTaskToCloud(id);
    },

    setStatus(ref, status) {
      if (status === "COMPLETED") {
        fireConfetti({ particleCount: 65 });
      }
      commit((db) => applyStatus(db, ref, status));
      syncSubtree(get().db, ref.taskId);
    },

    toggleComplete(instance) {
      const ref = refOf(instance);
      const previous = instance.storedStatus;
      const next: StoredStatus =
        previous === "COMPLETED" ? "TODO" : "COMPLETED";
      // Read before the write: these are the subtasks the completion is about
      // to carry with it, and the undo has to know how to put them back.
      const cascaded =
        next === "COMPLETED" ? openDescendants(get().db, ref.taskId) : [];

      if (next === "COMPLETED") {
        fireConfetti({ particleCount: 65 });
      }

      commit((db) => applyStatus(db, ref, next));
      syncSubtree(get().db, ref.taskId);

      // Ticking the wrong row off a dense list is the single easiest mistake to
      // make in this app, and the one most likely to go unnoticed.
      useUndoStore
        .getState()
        .push(
          next === "COMPLETED" ? "undoneTaskCompleted" : "undoneTaskReopened",
          () => {
            get().setStatus(ref, previous);
            for (const id of cascaded) {
              get().setStatus({ taskId: id, occurrenceDate: null }, "TODO");
            }
          },
        );
    },

    /**
     * Move a task to another day (and optionally another time).
     *
     * This is what a drag across the calendar means, so it has to behave like
     * one: a four-day run dropped on a new day stays four days long, and a
     * timed task keeps its duration rather than collapsing to a point.
     */
    reschedule(taskId, dueDate, startTime) {
      const before = get().db.tasks.find((t) => t.id === taskId);
      if (!before) return;
      if (
        before.dueDate === dueDate &&
        (startTime === undefined || before.startTime === startTime)
      ) {
        return;
      }

      commit((db) => {
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) return db;
        const patch: TaskPatch = {
          dueDate,
          endDate: shiftedEnd(task, dueDate),
        };
        if (startTime !== undefined) {
          patch.startTime = startTime;
          patch.endTime = shiftedEndTime(task, startTime);
          // Dropped on a clock slot it is a timed task; dropped in the all-day
          // strip it is not. Either way the drop said so explicitly.
          patch.allDay = startTime === null;
        }
        const next = { ...task, ...patch, updatedAt: nowInstant() };
        return appendHistory(
          { ...db, tasks: db.tasks.map((t) => (t.id === taskId ? next : t)) },
          historyEntry({
            taskId,
            kind: "RESCHEDULED",
            field: "schedule",
            from: describeSchedule(task),
            to: describeSchedule(next),
          }),
        );
      });

      const updated = get().db.tasks.find((t) => t.id === taskId);
      if (updated) void syncTaskToCloud(updated);

      // Dropping a task on the wrong cell is a one-pixel mistake; taking it
      // back should not mean remembering which day it came from.
      useUndoStore.getState().push("undoneTaskMoved", () => {
        get().updateTask(taskId, {
          dueDate: before.dueDate,
          endDate: before.endDate ?? null,
          startTime: before.startTime,
          endTime: before.endTime,
        });
      });
    },

    /**
     * Spec section 8. A snooze always postpones. When the postponement lands on
     * a different day it *also* moves the task, and both facts are written to
     * history so the trail shows what happened and why.
     */
    snooze(instance, preset, customTarget) {
      const { settings } = get().db;
      const now = new Date(get().now);
      const outcome = resolveSnooze(
        instance,
        preset,
        settings,
        now,
        customTarget,
      );
      const ref = refOf(instance);

      commit((db) => {
        const task = db.tasks.find((t) => t.id === instance.task.id);
        if (!task) return db;

        let next = db;
        const entries: HistoryEntry[] = [
          historyEntry({
            taskId: task.id,
            kind: "SNOOZED",
            occurrenceDate: ref.occurrenceDate,
            field: "snoozedUntil",
            from: instance.snoozedUntil,
            to: outcome.until,
          }),
        ];

        if (outcome.reschedule) {
          const moved: Task = {
            ...task,
            dueDate: outcome.reschedule.date,
            startTime: outcome.reschedule.startTime,
            updatedAt: nowInstant(),
          };
          entries.push(
            historyEntry({
              taskId: task.id,
              kind: "RESCHEDULED",
              field: "schedule",
              from: describeSchedule(task),
              to: describeSchedule(moved),
              note: `Snoozed, moved to ${outcome.reschedule.date}`,
            }),
          );
          next = {
            ...next,
            tasks: next.tasks.map((t) => (t.id === task.id ? moved : t)),
          };
        }

        next = writeSnoozeUntil(next, ref, outcome.until);

        // A snoozed task must stop nagging: its reminders wait with it.
        next = {
          ...next,
          reminders: next.reminders.map((r) =>
            r.taskId === task.id
              ? {
                  ...r,
                  snoozedUntil: outcome.until,
                  status: "PENDING" as const,
                }
              : r,
          ),
        };
        return appendHistory(next, ...entries);
      });
    },

    clearSnooze(ref) {
      commit((db) => writeSnoozeUntil(db, ref, null));
    },
















    /**
     * Rewrite one parent's sibling order from a list of ids.
     *
     * The caller sends the whole order rather than a from/to pair, so a drag
     * that crossed several rows is one write and the stored `order` values stay
     * a dense 0..n-1 run instead of drifting apart.
     *
     * No history entry: the trail records what happened to a task's schedule and
     * status, and a row that only changed places would bury those in noise.
     */
    makePlan(taskId) {
      const task = get().db.tasks.find((t) => t.id === taskId);
      if (!task || (task.tags.includes("plan") && task.parentId === null))
        return;
      if (task.parentId !== null) get().setParent(taskId, null);
      get().updateTask(taskId, {
        tags: [...task.tags.filter((tag) => tag !== "plan"), "plan"],
        dueDate: null,
        startTime: null,
        endTime: null,
        allDay: true,
      });
    },

    setParent(taskId, parentId) {
      const before = get().db;
      const task = before.tasks.find((t) => t.id === taskId);
      if (!task || (task.parentId ?? null) === parentId) return;
      if (parentId !== null) {
        const parent = before.tasks.find((t) => t.id === parentId);
        // Refusing a descendant is what keeps the tree a tree.
        if (
          !parent ||
          collectSubtree(before.tasks, taskId).includes(parentId)
        ) {
          return;
        }
      }

      commit((db) => {
        const siblings = db.tasks.filter(
          (t) => (t.parentId ?? null) === parentId && t.id !== taskId,
        );
        const at = nowInstant();
        /*
         * Moving a task into a plan moves it into the plan's category — that is
         * what "this belongs to the thesis now" means, and it is the whole
         * reason the task was dragged there.
         *
         * A plan with no category of its own claims nothing: clearing the
         * task's category would destroy information to express nothing.
         */
        const newParent =
          parentId === null
            ? null
            : (db.tasks.find((t) => t.id === parentId) ?? null);
        const adopted = newParent?.categoryId ?? null;
        const categoryId = adopted ?? task.categoryId;

        /*
         * …and into its urgency, but only where the task has none of its own.
         *
         * `NONE` is the absence of an answer, not an answer — nothing in the
         * app sets it deliberately — so filling it in from the plan takes
         * nothing away. A task that says LOW keeps saying LOW under a HIGH
         * plan: that one *was* somebody's answer, and overwriting it would be
         * the move quietly disagreeing with them.
         */
        const priority =
          task.priority === "NONE" ? (newParent?.priority ?? "NONE") : task.priority;

        const next: Task = {
          ...task,
          parentId,
          categoryId,
          priority,
          order: siblings.length,
          // The pin it carried belonged to the list it just left.
          manualOrder: null,
          updatedAt: at,
        };

        // Whatever hung below the task comes with it.
        const followers = new Set(
          collectSubtree(db.tasks, taskId).filter(
            (id) =>
              id !== taskId &&
              db.tasks.find((t) => t.id === id)?.categoryId !== categoryId,
          ),
        );
        const parentTitle =
          parentId === null
            ? null
            : (db.tasks.find((t) => t.id === parentId)?.title ?? "");
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              t.id === taskId
                ? next
                : followers.has(t.id)
                  ? { ...t, categoryId, updatedAt: at }
                  : t,
            ),
          },
          historyEntry({
            taskId,
            kind: "UPDATED",
            field: "parent",
            note:
              parentTitle === null
                ? `Detached from "${
                    before.tasks.find((t) => t.id === task.parentId)?.title ??
                    ""
                  }"`
                : `Filed under "${parentTitle}"`,
          }),
        );
      });

      // The subtree may have changed category along with the move.
      syncSubtree(get().db, taskId);
    },

    reorderSubtasks(parentId, orderedIds) {
      commit((db) => {
        const position = new Map(orderedIds.map((id, index) => [id, index]));
        const at = nowInstant();
        return {
          ...db,
          tasks: db.tasks.map((task) => {
            const next =
              task.parentId === parentId ? position.get(task.id) : undefined;
            return next === undefined || next === task.order
              ? task
              : { ...task, order: next, updatedAt: at };
          }),
        };
      });
    },

    /**
     * Pin the dragged row, and re-pin whatever was already pinned.
     *
     * Re-pinning matters: a pin is a slot, so leaving the old ones on their
     * stale numbers would let two rows claim one slot and the list would settle
     * somewhere other than where the user let go.
     *
     * `updatedAt` is deliberately left alone. A pin never leaves this device,
     * and bumping the clock for it would hand this device a win in every
     * last-write-wins merge over an edit another device really made.
     */
    reorderTasks(orderedIds, movedId) {
      commit((db) => {
        const position = new Map(orderedIds.map((id, index) => [id, index]));
        return {
          ...db,
          tasks: db.tasks.map((task) => {
            const slot = position.get(task.id);
            if (slot === undefined) return task;
            const pinned = task.id === movedId || pinOf(task) !== null;
            const next = pinned ? slot : null;
            return next === pinOf(task) ? task : { ...task, manualOrder: next };
          }),
        };
      });
    },

    clearManualOrder(taskIds) {
      const ids = new Set(taskIds);
      commit((db) => ({
        ...db,
        tasks: db.tasks.map((task) =>
          ids.has(task.id) && pinOf(task) !== null
            ? { ...task, manualOrder: null }
            : task,
        ),
      }));
    },

    /* Bulk ------------------------------------------------------------ */

    bulkUpdateTasks(taskIds, patch) {
      for (const taskId of [...new Set(taskIds)]) get().updateTask(taskId, patch);
    },

    bulkSetStatus(taskIds, status) {
      const unique = [...new Set(taskIds)];
      if (unique.length === 0) return;
      if (status === "COMPLETED") fireConfetti({ particleCount: 65 });

      const now = new Date(get().now);

      // Folded into one commit so the list re-sorts once rather than once per
      // task, which is the difference between a tick and a cascade of jumps.
      commit((db) => {
        // Rebuilt per reduction step: an earlier task in the batch may have
        // just written the occurrence row a later one reads.
        const refFor = (current: Database, taskId: string): InstanceRef | null => {
          const task = current.tasks.find((t) => t.id === taskId);
          if (!task) return null;
          // A repeating task keeps its status per occurrence — writing the
          // task row instead would be invisible in every view, since
          // `toInstance` reads the occurrence and ignores `task.status`. The
          // occurrence chosen is the one the row was showing: the first that
          // is not already done.
          if (!task.recurrence) return { taskId, occurrenceDate: null };
          const occurrences = new Map(
            current.occurrences.map((occurrence) => [occurrence.id, occurrence]),
          );
          return refOf(representativeInstance(task, occurrences, now));
        };

        return unique.reduce((acc, taskId) => {
          const ref = refFor(acc, taskId);
          return ref ? applyStatus(acc, ref, status) : acc;
        }, db);
      });
      for (const taskId of unique) syncSubtree(get().db, taskId);
    },

    bulkDeleteTasks(taskIds) {
      const unique = [...new Set(taskIds)];
      if (unique.length === 0) return;

      commit((db) => {
        const at = nowInstant();
        // A subtree per selected task, unioned: picking a plan *and* one of its
        // steps must not trash — or history — that step twice.
        const ids = new Set(
          unique.flatMap((taskId) => collectSubtree(db.tasks, taskId)),
        );
        const entries = [...ids].map((id) =>
          historyEntry({ taskId: id, kind: "DELETED", note: "Moved to trash" }),
        );
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              ids.has(t.id) ? { ...t, deletedAt: at, updatedAt: at } : t,
            ),
          },
          ...entries,
        );
      });

      for (const taskId of unique) syncSubtree(get().db, taskId);

      useUndoStore.getState().push("undoneTasksDeleted", () => {
        for (const taskId of unique) get().restoreTask(taskId);
      });
    },

    /* Budget ---------------------------------------------------------- */








    /**
     * Move unfinished work forward instead of letting it rot in the past.
     *
     * The most common way a task list dies is that yesterday's undone items sit
     * there accusing the user until they stop opening the app. Rolling them
     * forward is a deliberate, one-click act — never automatic, because a task
     * that silently moves itself is a task whose real due date you can no
     * longer trust — and every move is written to history like any reschedule.
     *
     * A recurring series is skipped: its dates come from its rule, and dragging
     * the anchor would move every future occurrence too.
     */
    rollOverTo(taskIds, date) {
      const wanted = new Set(taskIds);
      const eligible = get().db.tasks.filter(
        (t) =>
          wanted.has(t.id) &&
          t.deletedAt === null &&
          t.recurrence === null &&
          t.status !== "COMPLETED" &&
          t.dueDate !== null &&
          t.dueDate < date,
      );
      if (eligible.length === 0) return 0;

      const movedIds = new Set(eligible.map((t) => t.id));
      const at = nowInstant();

      commit((db) => {
        const entries: HistoryEntry[] = [];
        const tasks = db.tasks.map((task) => {
          if (!movedIds.has(task.id)) return task;
          const moved: Task = {
            ...task,
            dueDate: date,
            // A run that never finished restarts today rather than keeping an
            // end date that is now behind its own start.
            endDate:
              task.endDate && task.endDate < date
                ? null
                : (task.endDate ?? null),
            snoozedUntil: null,
            updatedAt: at,
          };
          entries.push(
            historyEntry({
              taskId: task.id,
              kind: "RESCHEDULED",
              field: "schedule",
              from: describeSchedule(task),
              to: describeSchedule(moved),
              note: "Rolled over",
            }),
          );
          return moved;
        });
        return appendHistory({ ...db, tasks }, ...entries);
      });

      for (const task of get().db.tasks) {
        if (movedIds.has(task.id)) void syncTaskToCloud(task);
      }

      // Remember where each one came from: a bulk move is exactly the kind of
      // action people want back the second they see what it did.
      const before = new Map(eligible.map((t) => [t.id, t.dueDate]));
      useUndoStore.getState().push("undoneRolledOver", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          tasks: db.tasks.map((task) => {
            const original = before.get(task.id);
            return original === undefined
              ? task
              : { ...task, dueDate: original, updatedAt: at2 };
          }),
        }));
        for (const task of get().db.tasks) {
          if (before.has(task.id)) void syncTaskToCloud(task);
        }
      });

      return movedIds.size;
    },




    convertToNote(taskId) {
      const db = get().db;
      const task = db.tasks.find((t) => t.id === taskId);
      if (!task || task.deletedAt !== null || task.tags.includes(NOTE_TAG)) {
        return false;
      }
      // Refused rather than fudged: nothing renders the children of a note.
      const hasSubtasks = db.tasks.some(
        (t) => t.parentId === taskId && t.deletedAt === null,
      );
      if (hasSubtasks) return false;

      const at = nowInstant();
      const before = {
        tags: task.tags,
        dueDate: task.dueDate,
        endDate: task.endDate ?? null,
        deadline: task.deadline ?? null,
        recurrence: task.recurrence,
        startTime: task.startTime,
        endTime: task.endTime,
        allDay: task.allDay,
      };
      /*
       * The reminders go with the schedule they were set against.
       *
       * A RELATIVE one has nothing left to count back from once the date is
       * gone, and an ABSOLUTE one would go on firing for something that now
       * lives in Notes and shows nowhere else. They are handed to the undo
       * whole, so taking this back really does take all of it back.
       */
      const dropped = db.reminders.filter((r) => r.taskId === taskId);

      commit((next) =>
        appendHistory(
          {
            ...next,
            tasks: next.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    tags: [...t.tags.filter((tag) => tag !== NOTE_TAG), NOTE_TAG],
                    dueDate: null,
                    endDate: null,
                    deadline: null,
                    recurrence: null,
                    startTime: null,
                    endTime: null,
                    allDay: true,
                    updatedAt: at,
                  }
                : t,
            ),
            reminders: next.reminders.filter((r) => r.taskId !== taskId),
          },
          historyEntry({
            taskId,
            kind: "UPDATED",
            field: "type",
            from: "task",
            to: "note",
          }),
        ),
      );

      useUndoStore.getState().push("undoneConvertedToNote", () => {
        const at2 = nowInstant();
        commit((next) => ({
          ...next,
          tasks: next.tasks.map((t) =>
            t.id === taskId ? { ...t, ...before, updatedAt: at2 } : t,
          ),
          reminders: [
            ...next.reminders.filter((r) => r.taskId !== taskId),
            ...dropped,
          ],
        }));
      });

      return true;
    },











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
