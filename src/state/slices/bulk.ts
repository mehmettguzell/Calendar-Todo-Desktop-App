import {
  appendHistory,
  applyStatus,
  collectSubtree,
  refOf,
  syncSubtree,
} from "../taskMutations";
import { useUndoStore } from "../undoStore";
import type { Database } from "@/data/db";
import { nowInstant } from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { NOTE_TAG } from "@/domain/note";
import { representativeInstance } from "@/domain/task";
import type { Instant, InstanceRef, Task } from "@/domain/types";
import { fireConfetti } from "@/lib/confetti";
import type { SliceTools, StoreState } from "../storeState";

// Actions over a selection, plus the one conversion that changes a task's kind.
export type BulkSlice = Pick<
  StoreState,
  | "bulkUpdateTasks"
  | "bulkSetStatus"
  | "bulkDeleteTasks"
  | "convertToNote"
>;

/** Everything a note gives up, kept whole so undo can hand it all back. */
function scheduleOf(task: Task) {
  return {
    tags: task.tags,
    dueDate: task.dueDate,
    endDate: task.endDate ?? null,
    deadline: task.deadline ?? null,
    recurrence: task.recurrence,
    startTime: task.startTime,
    endTime: task.endTime,
    allDay: task.allDay,
  };
}

function asNote(db: Database, taskId: string, at: Instant): Database {
  return {
    ...db,
    tasks: db.tasks.map((t) =>
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
    reminders: db.reminders.filter((r) => r.taskId !== taskId),
  };
}

export function createBulkSlice({ get, commit }: SliceTools): BulkSlice {
  return {
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
    convertToNote(taskId) {
      const db = get().db;
      const task = db.tasks.find((t) => t.id === taskId);
      if (!task || task.deletedAt !== null || task.tags.includes(NOTE_TAG)) {
        return false;
      }
      // Refused rather than fudged: nothing renders the children of a note.
      if (db.tasks.some((t) => t.parentId === taskId && t.deletedAt === null)) {
        return false;
      }

      const before = scheduleOf(task);
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
        appendHistory(asNote(next, taskId, nowInstant()), historyEntry({
          taskId,
          kind: "UPDATED",
          field: "type",
          from: "task",
          to: "note",
        })),
      );

      useUndoStore.getState().push("undoneConvertedToNote", () => {
        const at = nowInstant();
        commit((next) => ({
          ...next,
          tasks: next.tasks.map((t) =>
            t.id === taskId ? { ...t, ...before, updatedAt: at } : t,
          ),
          reminders: [
            ...next.reminders.filter((r) => r.taskId !== taskId),
            ...dropped,
          ],
        }));
      });

      return true;
    },
  };
}
