import { TaskPatch } from "../storeTypes";
import {
  appendHistory,
  applyStatus,
  describeSchedule,
  openDescendants,
  refOf,
  shiftedEnd,
  shiftedEndTime,
  syncSubtree,
  writeSnoozeUntil,
} from "../taskMutations";
import { useUndoStore } from "../undoStore";
import { nowInstant } from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { resolveSnooze } from "@/domain/snooze";
import {
  HistoryEntry,
  StoredStatus,
  Task,
} from "@/domain/types";
import { fireConfetti } from "@/lib/confetti";
import { syncTaskToCloud } from "@/sync/storeBridge";
import type { SliceTools, StoreState } from "../storeState";

// When a task is due and whether it is done — including per-occurrence status.
export type ScheduleSlice = Pick<
  StoreState,
  | "setStatus"
  | "toggleComplete"
  | "reschedule"
  | "snooze"
  | "clearSnooze"
  | "rollOverTo"
>;

export function createScheduleSlice({ get, commit }: SliceTools): ScheduleSlice {
  return {
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
  };
}
