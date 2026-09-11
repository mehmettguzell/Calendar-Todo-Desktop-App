import { useState, type MouseEvent } from "react";
import type { TaskInstance } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import {
  useCategoryIndex,
  useHasReminder,
  useSubtasks,
  useTrackedSeconds,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";
import type { RowReorder } from "../useListReorder";
import { useRequestDelete } from "../useRequestDelete";
import { usePickGesture } from "../usePickGesture";
import type { Task } from "@/domain/types";

export interface TaskRowInput {
  instance: TaskInstance;
  onOpen: (instance: TaskInstance) => void;
  showDate?: boolean;
  /**
   * Supplied by a list that can be rearranged. Left out — in Trash, in search
   * results — the row has no grip and no drag behaviour at all, which is the
   * point: a task looks exactly as movable as it actually is.
   */
  reorder?: RowReorder;
  /** Right-click. Left out, the row has no menu — as in Trash and search. */
  onContextMenu?: (
    event: MouseEvent<HTMLDivElement>,
    task: TaskInstance,
  ) => void;
  /**
   * The ids of the list this row is drawn in, in the order it is drawn.
   *
   * Supplied only by lists where picking several tasks makes sense, and it is
   * what a Shift-click measures across: a range spanning two different lists is
   * not a range the user can see.
   */
  listIds?: string[];
}

/**
 * Everything one row needs to draw itself and act on its task.
 *
 * The row is the same component in Today, Todo, Search and Trash — one task has
 * one representation — so its parts read from one model rather than each deciding
 * again what the task's state is.
 */
/** Every store mutation a row offers, in one read. */
function useRowActions() {
  return {
    toggleComplete: useStore((s) => s.toggleComplete),
    updateTask: useStore((s) => s.updateTask),
    startFocus: useStore((s) => s.startFocus),
    stopFocus: useStore((s) => s.stopFocus),
    pauseFocus: useStore((s) => s.pauseFocus),
    resumeFocus: useStore((s) => s.resumeFocus),
    requestDelete: useRequestDelete(),
    pushUndo: useUndoStore((s) => s.push),
  };
}

/** What the row shows about the task, beyond the task itself. */
function useRowFacts(instance: TaskInstance) {
  const { task } = instance;
  const tasks = useStore((s) => s.db.tasks);
  const categories = useCategoryIndex();
  const subtasks = useSubtasks(task.id);
  const runningFocus = useStore((s) => s.runningFocus);
  const isFocused = runningFocus?.taskId === task.id;

  return {
    tasks,
    categories,
    subtasks,
    runningFocus,
    isFocused,
    isPaused: isFocused && runningFocus?.runStartedAt === null,
    hasReminder: useHasReminder(task.id),
    tracked: useTrackedSeconds(task.id),
    now: useNow(),
    parentTask: task.parentId
      ? (tasks.find((t) => t.id === task.parentId) ?? null)
      : null,
    category: task.categoryId ? categories.get(task.categoryId) : null,
    done: instance.storedStatus === "COMPLETED",
    doneSubtasks: subtasks.filter((s) => s.status === "COMPLETED").length,
    isLate: instance.status === "OVERDUE",
    time: rowTime(task),
  };
}

/** The clock a timed task shows, or null for an all-day one. */
function rowTime(task: Task): string | null {
  if (task.allDay || !task.startTime) return null;
  return task.endTime ? `${task.startTime} – ${task.endTime}` : task.startTime;
}

export function useTaskRow(input: TaskRowInput) {
  const { instance, onOpen, showDate = true, reorder, onContextMenu, listIds } = input;
  const { task } = instance;
  const { t } = useI18n();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  /*
   * Picking stays out of sight until it is asked for.
   *
   * A modifier click is what asks for it — the gesture every file list on every
   * desktop already uses — and only then does the checkbox column appear. A list
   * nobody is selecting in looks exactly as it did before selecting existed. The
   * gesture is shared with the month grid and the note wall, so all three answer
   * a click the same way.
   */
  const pick = usePickGesture({
    taskId: task.id,
    listIds,
    enabled: listIds !== undefined,
  });

  const drag: Partial<RowReorder> = reorder ?? {};
  const { onGripKeyDown, className: dragClass, ...dragHandlers } = drag;

  return {
    ...useRowActions(),
    ...useRowFacts(instance),
    ...pick,
    task,
    instance,
    onOpen,
    showDate,
    reorder,
    onContextMenu,
    listIds,
    t,
    snoozeOpen,
    setSnoozeOpen,
    menuOpen,
    setMenuOpen,
    onGripKeyDown,
    dragClass,
    dragHandlers,
  };
}

export type TaskRowModel = ReturnType<typeof useTaskRow>;
