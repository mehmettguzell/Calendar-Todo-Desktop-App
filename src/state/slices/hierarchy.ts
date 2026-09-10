import {
  appendHistory,
  collectSubtree,
  syncSubtree,
} from "../taskMutations";
import { nowInstant } from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { pinOf } from "@/domain/manualOrder";
import { Task } from "@/domain/types";
import type { Database } from "@/data/db";
import type { Instant } from "@/domain/types";
import type { SliceTools, StoreState } from "../storeState";

// Parent/child structure and the manual order the user drags rows into.
export type HierarchySlice = Pick<
  StoreState,
  | "makePlan"
  | "setParent"
  | "reorderSubtasks"
  | "reorderTasks"
  | "clearManualOrder"
>;

/** Refusing a descendant as the new parent is what keeps the tree a tree. */
function canReparent(
  db: Database,
  taskId: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  const parent = db.tasks.find((t) => t.id === parentId);
  return Boolean(parent) && !collectSubtree(db.tasks, taskId).includes(parentId);
}

/**
 * The moved task, wearing what its new home implies.
 *
 * Category is adopted outright — "this belongs to the thesis now" is the whole
 * reason it was dragged there — but a plan with no category of its own claims
 * nothing. Priority is only filled in where the task has none: `NONE` is the
 * absence of an answer, while `LOW` under a `HIGH` plan was somebody's answer
 * and overwriting it would be the move disagreeing with them.
 */
function reparented(
  db: Database,
  task: Task,
  newParent: Task | null,
  parentId: string | null,
  at: Instant,
): Task {
  const siblings = db.tasks.filter(
    (t) => (t.parentId ?? null) === parentId && t.id !== task.id,
  );
  return {
    ...task,
    parentId,
    categoryId: newParent?.categoryId ?? task.categoryId,
    priority:
      task.priority === "NONE" ? (newParent?.priority ?? "NONE") : task.priority,
    order: siblings.length,
    // The pin it carried belonged to the list it just left.
    manualOrder: null,
    updatedAt: at,
  };
}

export function createHierarchySlice({ get, commit }: SliceTools): HierarchySlice {
  return {
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
      const task = get().db.tasks.find((t) => t.id === taskId);
      if (!task || (task.parentId ?? null) === parentId) return;
      if (!canReparent(get().db, taskId, parentId)) return;
      const detachedFrom =
        get().db.tasks.find((t) => t.id === task.parentId)?.title ?? "";

      commit((db) => {
        const at = nowInstant();
        const newParent =
          parentId === null
            ? null
            : (db.tasks.find((t) => t.id === parentId) ?? null);
        const next = reparented(db, task, newParent, parentId, at);
        // Whatever hung below the task comes with it.
        const followers = new Set(
          collectSubtree(db.tasks, taskId).filter(
            (id) =>
              id !== taskId &&
              db.tasks.find((t) => t.id === id)?.categoryId !== next.categoryId,
          ),
        );

        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              t.id === taskId
                ? next
                : followers.has(t.id)
                  ? { ...t, categoryId: next.categoryId, updatedAt: at }
                  : t,
            ),
          },
          historyEntry({
            taskId,
            kind: "UPDATED",
            field: "parent",
            note:
              newParent === null
                ? `Detached from "${detachedFrom}"`
                : `Filed under "${newParent.title}"`,
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
  };
}
