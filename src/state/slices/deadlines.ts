import {
  useUndoStore,
} from "../undoStore";
import {
  nowInstant,
} from "@/domain/datetime";
import {
  normaliseLabel,
  type Deadline,
} from "@/domain/deadline";
import {
  historyEntry,
} from "@/domain/history";
import {
  createId,
} from "@/domain/ids";
import { appendHistory } from "../taskMutations";
import type { SliceTools, StoreState } from "../storeState";

// Checkpoints hanging off a task: dated, orderable, and undo-able.
export type DeadlineSlice = Pick<
  StoreState,
  | "addDeadline"
  | "updateDeadline"
  | "setDeadlineMet"
  | "removeDeadline"
>;

export function createDeadlineSlice({ get, commit }: SliceTools): DeadlineSlice {
  return {
  addDeadline(draft) {
    // A checkpoint with no name is a bare date nobody can act on, so an
    // empty label is refused here rather than stored and hidden later.
    const label = normaliseLabel(draft.label);
    if (!label || !draft.date) return null;

    const at = nowInstant();
    const deadline: Deadline = {
      id: createId("dl"),
      taskId: draft.taskId,
      label,
      date: draft.date,
      completedAt: null,
      // Only ever a tie-breaker between two checkpoints on one day; the list
      // itself is ordered by date, which is the order dates come in.
      order: get().db.deadlines.filter((d) => d.taskId === draft.taskId).length,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    commit((db) =>
      appendHistory(
        { ...db, deadlines: [...db.deadlines, deadline] },
        historyEntry({
          taskId: deadline.taskId,
          kind: "DEADLINE_ADDED",
          field: deadline.label,
          to: deadline.date,
        }),
      ),
    );
    return deadline;
  },
  updateDeadline(id, patch) {
    const at = nowInstant();
    const previous = get().db.deadlines.find((d) => d.id === id);
    if (!previous) return;
    const label =
      patch.label === undefined
        ? previous.label
        : (normaliseLabel(patch.label) ?? previous.label);
    const date = patch.date || previous.date;

    commit((db) => {
      const next = {
        ...db,
        deadlines: db.deadlines.map((d) =>
          d.id === id ? { ...d, ...patch, label, date, updatedAt: at } : d,
        ),
      };
      // Moving a checkpoint is the kind of edit people forget making, so the
      // trail records the move itself rather than just that something changed.
      return date === previous.date
        ? next
        : appendHistory(
            next,
            historyEntry({
              taskId: previous.taskId,
              kind: "RESCHEDULED",
              field: label,
              from: previous.date,
              to: date,
            }),
          );
    });
  },
  setDeadlineMet(id, met) {
    const at = nowInstant();
    const previous = get().db.deadlines.find((d) => d.id === id);
    if (!previous || (previous.completedAt !== null) === met) return;
    commit((db) => {
      const next = {
        ...db,
        deadlines: db.deadlines.map((d) =>
          d.id === id ? { ...d, completedAt: met ? at : null, updatedAt: at } : d,
        ),
      };
      return met
        ? appendHistory(
            next,
            historyEntry({
              taskId: previous.taskId,
              kind: "DEADLINE_MET",
              field: previous.label,
              to: previous.date,
            }),
          )
        : next;
    });
  },
  removeDeadline(id) {
    const at = nowInstant();
    const previous = get().db.deadlines.find((d) => d.id === id);
    if (!previous) return;
    commit((db) =>
      appendHistory(
        {
          ...db,
          deadlines: db.deadlines.map((d) =>
            d.id === id ? { ...d, deletedAt: at, updatedAt: at } : d,
          ),
        },
        historyEntry({
          taskId: previous.taskId,
          kind: "DEADLINE_REMOVED",
          field: previous.label,
          from: previous.date,
        }),
      ),
    );
    useUndoStore.getState().push("undoneDeadlineRemoved", () => {
      const at2 = nowInstant();
      commit((db) => ({
        ...db,
        deadlines: db.deadlines.map((d) =>
          d.id === id ? { ...d, deletedAt: null, updatedAt: at2 } : d,
        ),
      }));
    });
  },
  };
}
