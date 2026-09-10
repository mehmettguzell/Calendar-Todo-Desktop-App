import {
  appendHistory,
  collectSubtree,
  syncSubtree,
} from "../taskMutations";
import { nowInstant } from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { pinOf } from "@/domain/manualOrder";
import { Task } from "@/domain/types";
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
  };
}
