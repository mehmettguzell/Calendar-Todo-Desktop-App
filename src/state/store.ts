import { useMemo } from "react";
import { create } from "zustand";
import { createRepository } from "@/data/createRepository";
import { emptyDatabase, type Database } from "@/data/db";
import type { Repository } from "@/data/repository";
import { nowInstant, toInstant, toLocalDate } from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { createId, occurrenceId } from "@/domain/ids";
import { toInstance } from "@/domain/task";
import { resolveSnooze, type SnoozePresetId } from "@/domain/snooze";
import type {
  Category,
  FocusSession,
  HistoryEntry,
  InstanceRef,
  LocalDate,
  Occurrence,
  Priority,
  Recurrence,
  Reminder,
  Settings,
  StoredStatus,
  Task,
  TaskInstance,
} from "@/domain/types";

export interface TaskDraft {
  title: string;
  description?: string;
  priority?: Priority;
  dueDate?: LocalDate | null;
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  categoryId?: string | null;
  tags?: string[];
  parentId?: string | null;
  recurrence?: Recurrence | null;
}

/** Fields a user may edit; everything else is bookkeeping owned by the store. */
export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "priority"
    | "dueDate"
    | "allDay"
    | "startTime"
    | "endTime"
    | "categoryId"
    | "tags"
    | "recurrence"
    | "order"
    | "parentId"
  >
>;

export interface RunningFocus {
  sessionId: string;
  taskId: string;
  occurrenceDate: LocalDate | null;
  startedAt: string;
}

interface StoreState {
  ready: boolean;
  db: Database;
  /** Ticks once a minute so derived statuses (OVERDUE) stay honest. */
  now: number;
  runningFocus: RunningFocus | null;

  hydrate(): Promise<void>;
  tick(): void;

  createTask(draft: TaskDraft): Task;
  updateTask(taskId: string, patch: TaskPatch, note?: string): void;
  deleteTask(taskId: string): void;
  restoreTask(taskId: string): void;
  purgeTask(taskId: string): void;

  setStatus(ref: InstanceRef, status: StoredStatus): void;
  toggleComplete(instance: TaskInstance): void;
  reschedule(
    taskId: string,
    dueDate: LocalDate | null,
    startTime?: string | null,
  ): void;
  snooze(
    instance: TaskInstance,
    preset: SnoozePresetId,
    customTarget?: Date,
  ): void;
  clearSnooze(ref: InstanceRef): void;

  addReminder(
    reminder: Omit<
      Reminder,
      "id" | "createdAt" | "status" | "snoozedUntil" | "lastFiredFor"
    >,
  ): void;
  removeReminder(reminderId: string): void;
  markReminderFired(reminderId: string, occurrenceDate: LocalDate | null): void;
  snoozeReminder(reminderId: string, until: string): void;
  dismissReminder(reminderId: string): void;

  startFocus(instance: TaskInstance): void;
  stopFocus(): void;
  cancelFocus(): void;
  clearFocusSessions(): void;

  addCategory(name: string, color: string): Category;
  updateCategory(
    id: string,
    patch: Partial<Pick<Category, "name" | "color">>,
  ): void;
  removeCategory(id: string): void;

  reorderSubtasks(parentId: string, orderedIds: string[]): void;

  updateSettings(patch: Partial<Settings>): void;

  clearHistory(): void;
  emptyTrash(): void;
  resetDatabase(): Promise<void>;
}

let repository: Repository | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced write-behind: the UI never waits on the disk. */
function persist(db: Database) {
  if (!repository) return;
  if (saveTimer) clearTimeout(saveTimer);
  const repo = repository;
  saveTimer = setTimeout(() => {
    void repo
      .save(db)
      .catch((error) => console.error("[tempo] save failed", error));
  }, 250);
}

/**
 * Write immediately, cancelling any pending debounced write.
 *
 * Used by destructive actions: after "reset everything" the file on disk must
 * already be empty, because the next thing the user does may well be to close
 * the app — and a queued write holding the *old* document would then land on
 * top of the reset, or never land at all.
 */
async function persistNow(db: Database): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!repository) return;
  await repository.save(db);
}

export const useStore = create<StoreState>((set, get) => {
  /** Every mutation goes through here, so nothing can skip history or persistence. */
  const commit = (mutate: (db: Database) => Database) => {
    set((state) => {
      const db = mutate(state.db);
      persist(db);
      return { db };
    });
  };

  const appendHistory = (
    db: Database,
    ...entries: HistoryEntry[]
  ): Database => ({
    ...db,
    history: [...db.history, ...entries],
  });

  return {
    ready: false,
    db: emptyDatabase(),
    now: Date.now(),
    runningFocus: null,

    async hydrate() {
      repository = createRepository();
      const loaded = await repository.load().catch((error) => {
        console.error("[tempo] load failed", error);
        return null;
      });
      const db = loaded ?? emptyDatabase();
      set({ db, ready: true, now: Date.now() });
      if (!loaded) persist(db);
    },

    tick() {
      const state = get();
      const nowMs = Date.now();
      const cutoff = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

      const toPurge = state.db.tasks
        .filter((t) => t.deletedAt !== null && t.deletedAt < cutoff)
        .map((t) => t.id);

      if (toPurge.length > 0) {
        commit((db) => ({
          ...db,
          tasks: db.tasks.filter((t) => !toPurge.includes(t.id)),
          occurrences: db.occurrences.filter(
            (o) => !toPurge.includes(o.taskId),
          ),
          reminders: db.reminders.filter((r) => !toPurge.includes(r.taskId)),
        }));
      }

      set({ now: nowMs });
    },

    createTask(draft) {
      const at = nowInstant();
      const siblings = get().db.tasks.filter(
        (t) => t.parentId === (draft.parentId ?? null),
      );
      const task: Task = {
        id: createId("t"),
        title: draft.title.trim(),
        description: draft.description ?? "",
        status: "TODO",
        priority: draft.priority ?? "NONE",
        dueDate: draft.dueDate ?? null,
        allDay: draft.allDay ?? true,
        startTime: draft.startTime ?? null,
        endTime: draft.endTime ?? null,
        categoryId: draft.categoryId ?? null,
        tags: draft.tags ?? [],
        parentId: draft.parentId ?? null,
        recurrence: draft.recurrence ?? null,
        snoozedUntil: null,
        order: siblings.length,
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
      return task;
    },

    updateTask(taskId, patch, note) {
      commit((db) => {
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) return db;

        const entries: HistoryEntry[] = [];
        const scheduleChanged =
          ("dueDate" in patch && patch.dueDate !== task.dueDate) ||
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
          "tags",
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

        const next = { ...task, ...patch, updatedAt: nowInstant() };
        return appendHistory(
          { ...db, tasks: db.tasks.map((t) => (t.id === taskId ? next : t)) },
          ...entries,
        );
      });
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
    },

    /** Hard delete. History rows survive: they are the record that it existed. */
    purgeTask(taskId) {
      commit((db) => {
        const ids = collectSubtree(db.tasks, taskId);
        return {
          ...db,
          tasks: db.tasks.filter((t) => !ids.includes(t.id)),
          occurrences: db.occurrences.filter((o) => !ids.includes(o.taskId)),
          reminders: db.reminders.filter((r) => !ids.includes(r.taskId)),
        };
      });
    },

    setStatus(ref, status) {
      commit((db) => applyStatus(db, ref, status));
    },

    toggleComplete(instance) {
      const ref = refOf(instance);
      const next: StoredStatus =
        instance.storedStatus === "COMPLETED" ? "TODO" : "COMPLETED";
      commit((db) => applyStatus(db, ref, next));
    },

    reschedule(taskId, dueDate, startTime) {
      commit((db) => {
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) return db;
        const patch: TaskPatch = { dueDate };
        if (startTime !== undefined) patch.startTime = startTime;
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

    addReminder(input) {
      const reminder: Reminder = {
        ...input,
        id: createId("r"),
        status: "PENDING",
        snoozedUntil: null,
        lastFiredFor: null,
        createdAt: nowInstant(),
      };
      commit((db) =>
        appendHistory(
          { ...db, reminders: [...db.reminders, reminder] },
          historyEntry({ taskId: reminder.taskId, kind: "REMINDER_ADDED" }),
        ),
      );
    },

    removeReminder(reminderId) {
      commit((db) => {
        const reminder = db.reminders.find((r) => r.id === reminderId);
        if (!reminder) return db;
        return appendHistory(
          { ...db, reminders: db.reminders.filter((r) => r.id !== reminderId) },
          historyEntry({ taskId: reminder.taskId, kind: "REMINDER_REMOVED" }),
        );
      });
    },

    markReminderFired(reminderId, occurrenceDate) {
      commit((db) => {
        const reminder = db.reminders.find((r) => r.id === reminderId);
        if (!reminder) return db;
        const task = db.tasks.find((t) => t.id === reminder.taskId);
        const recurring = task?.recurrence != null;
        const next: Reminder = {
          ...reminder,
          // A series keeps its reminder alive for the next occurrence.
          status: recurring ? "PENDING" : "FIRED",
          lastFiredFor: occurrenceDate ?? reminder.lastFiredFor,
          snoozedUntil: null,
        };
        return appendHistory(
          {
            ...db,
            reminders: db.reminders.map((r) =>
              r.id === reminderId ? next : r,
            ),
          },
          historyEntry({
            taskId: reminder.taskId,
            kind: "REMINDER_FIRED",
            occurrenceDate: occurrenceDate ?? null,
          }),
        );
      });
    },

    snoozeReminder(reminderId, until) {
      commit((db) => ({
        ...db,
        reminders: db.reminders.map((r) =>
          r.id === reminderId
            ? { ...r, snoozedUntil: until, status: "PENDING" as const }
            : r,
        ),
      }));
    },

    dismissReminder(reminderId) {
      commit((db) => ({
        ...db,
        reminders: db.reminders.map((r) =>
          r.id === reminderId ? { ...r, status: "DISMISSED" as const } : r,
        ),
      }));
    },

    startFocus(instance) {
      const state = get();
      if (state.runningFocus) state.stopFocus();

      const session: FocusSession = {
        id: createId("f"),
        taskId: instance.task.id,
        occurrenceDate: instance.isRecurring ? instance.date : null,
        startedAt: nowInstant(),
        endedAt: null,
        durationSec: 0,
      };
      set({
        runningFocus: {
          sessionId: session.id,
          taskId: session.taskId,
          occurrenceDate: session.occurrenceDate,
          startedAt: session.startedAt,
        },
      });
      commit((db) => {
        const withSession = {
          ...db,
          focusSessions: [...db.focusSessions, session],
        };
        // Working on something is the definition of IN_PROGRESS.
        return instance.storedStatus === "TODO"
          ? applyStatus(withSession, refOf(instance), "IN_PROGRESS")
          : withSession;
      });
    },

    stopFocus() {
      const running = get().runningFocus;
      if (!running) return;
      const endedAt = new Date();
      const durationSec = Math.max(
        0,
        Math.round(
          (endedAt.getTime() - new Date(running.startedAt).getTime()) / 1000,
        ),
      );
      set({ runningFocus: null });
      commit((db) =>
        appendHistory(
          {
            ...db,
            focusSessions: db.focusSessions.map((s) =>
              s.id === running.sessionId
                ? { ...s, endedAt: toInstant(endedAt), durationSec }
                : s,
            ),
          },
          historyEntry({
            taskId: running.taskId,
            kind: "FOCUS_LOGGED",
            occurrenceDate: running.occurrenceDate,
            note: `Focused for ${Math.max(1, Math.round(durationSec / 60))} min`,
          }),
        ),
      );
    },

    cancelFocus() {
      const running = get().runningFocus;
      if (!running) return;
      set({ runningFocus: null });
      commit((db) => ({
        ...db,
        focusSessions: db.focusSessions.filter(
          (s) => s.id !== running.sessionId,
        ),
      }));
    },

    clearFocusSessions() {
      set({ runningFocus: null });
      commit((db) => ({
        ...db,
        focusSessions: [],
      }));
    },

    addCategory(name, color) {
      const category: Category = {
        id: createId("c"),
        name: name.trim(),
        color,
        order: get().db.categories.length,
      };
      commit((db) => ({ ...db, categories: [...db.categories, category] }));
      return category;
    },

    updateCategory(id, patch) {
      commit((db) => ({
        ...db,
        categories: db.categories.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      }));
    },

    removeCategory(id) {
      commit((db) => ({
        ...db,
        categories: db.categories.filter((c) => c.id !== id),
        tasks: db.tasks.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null } : t,
        ),
      }));
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
      commit((db) => {
        const ids = db.tasks
          .filter((t) => t.deletedAt !== null)
          .map((t) => t.id);
        if (ids.length === 0) return db;
        return {
          ...db,
          tasks: db.tasks.filter((t) => !ids.includes(t.id)),
          occurrences: db.occurrences.filter((o) => !ids.includes(o.taskId)),
          reminders: db.reminders.filter((r) => !ids.includes(r.taskId)),
        };
      });
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
/* Shared mutation helpers                                             */
/* ------------------------------------------------------------------ */

/** Where a mutation lands: the task row, or one occurrence of a series. */
function refOf(instance: TaskInstance): InstanceRef {
  return {
    taskId: instance.task.id,
    occurrenceDate: instance.isRecurring ? instance.date : null,
  };
}

/**
 * Write a status to the right place: the task itself, or the occurrence row of
 * a recurring series. Callers never need to know which, which is the whole
 * point of `InstanceRef`.
 */
function applyStatus(
  db: Database,
  ref: InstanceRef,
  status: StoredStatus,
): Database {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return db;

  const at = nowInstant();
  const completedAt = status === "COMPLETED" ? at : null;
  const entry = historyEntry({
    taskId: ref.taskId,
    kind: "STATUS_CHANGED",
    occurrenceDate: ref.occurrenceDate,
    field: "status",
    from: currentStoredStatus(db, ref),
    to: status,
  });

  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    const existing = db.occurrences.find((o) => o.id === id);
    const occurrence: Occurrence = {
      id,
      taskId: task.id,
      date: ref.occurrenceDate,
      status,
      completedAt,
      snoozedUntil:
        status === "COMPLETED" ? null : (existing?.snoozedUntil ?? null),
    };
    return {
      ...db,
      occurrences: existing
        ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
        : [...db.occurrences, occurrence],
      history: [...db.history, entry],
    };
  }

  const next: Task = {
    ...task,
    status,
    completedAt,
    snoozedUntil: status === "COMPLETED" ? null : task.snoozedUntil,
    updatedAt: at,
  };
  return {
    ...db,
    tasks: db.tasks.map((t) => (t.id === task.id ? next : t)),
    history: [...db.history, entry],
  };
}

function currentStoredStatus(db: Database, ref: InstanceRef): StoredStatus {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return "TODO";
  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    return db.occurrences.find((o) => o.id === id)?.status ?? "TODO";
  }
  return task.status;
}

function writeSnoozeUntil(
  db: Database,
  ref: InstanceRef,
  until: string | null,
): Database {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return db;

  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    const existing = db.occurrences.find((o) => o.id === id);
    const occurrence: Occurrence = existing
      ? { ...existing, snoozedUntil: until }
      : {
          id,
          taskId: task.id,
          date: ref.occurrenceDate,
          status: "TODO",
          completedAt: null,
          snoozedUntil: until,
        };
    return {
      ...db,
      occurrences: existing
        ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
        : [...db.occurrences, occurrence],
    };
  }
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === task.id
        ? { ...t, snoozedUntil: until, updatedAt: nowInstant() }
        : t,
    ),
  };
}

/** A task plus every descendant, so trash and restore act on a whole subtree. */
function collectSubtree(tasks: Task[], rootId: string): string[] {
  const out = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = tasks
      .filter((t) => t.parentId !== null && frontier.includes(t.parentId))
      .map((t) => t.id);
    const fresh = children.filter((id) => !out.includes(id));
    out.push(...fresh);
    frontier = fresh;
  }
  return out;
}

function describeSchedule(
  task: Pick<Task, "dueDate" | "allDay" | "startTime" | "endTime">,
): string {
  if (!task.dueDate) return "no date";
  if (task.allDay || !task.startTime) return `${task.dueDate} (all-day)`;
  return task.endTime
    ? `${task.dueDate} ${task.startTime}-${task.endTime}`
    : `${task.dueDate} ${task.startTime}`;
}

function serialise(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

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
