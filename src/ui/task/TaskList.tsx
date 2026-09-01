import { useMemo, type ReactNode } from "react";
import type { Task, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { TaskRow } from "./TaskRow";
import { useListReorder } from "./useListReorder";

/**
 * A list of task rows the user can rearrange by dragging.
 *
 * Every rearrangeable list in the app is this component, so a drag behaves the
 * same in Today, in Todo and on a board — and so the pins it writes are read
 * back by the one arrangement rule in `selectors.arrangeInstances`.
 */
export function TaskList({
  listId,
  instances,
  selectedKey,
  onOpen,
  showDate,
  className,
  empty,
  onAccept,
}: {
  /** Distinguishes this list from its neighbours during a drag. */
  listId: string;
  instances: TaskInstance[];
  selectedKey?: string | null;
  onOpen: (instance: TaskInstance) => void;
  showDate?: boolean;
  className?: string;
  /**
   * Shown in place of the rows when there are none — inside the drop target, so
   * an empty column is still somewhere a card can be dragged to.
   */
  empty?: ReactNode;
  /** Accept a row dragged in from a sibling list. See `useListReorder`. */
  onAccept?: (task: Task, slot: number) => void;
}) {
  const reorderTasks = useStore((s) => s.reorderTasks);
  const tasks = useStore((s) => s.db.tasks);

  const ids = useMemo(
    () => instances.map((instance) => instance.task.id),
    [instances],
  );

  const reorder = useListReorder({
    listId,
    ids,
    onReorder: reorderTasks,
    onAccept: onAccept
      ? (taskId, slot) => {
          const task = tasks.find((each) => each.id === taskId);
          if (task) onAccept(task, slot);
        }
      : undefined,
  });

  return (
    <div
      className={cn(className ?? "task-list", reorder.active && "reordering")}
      {...reorder.containerProps}
    >
      {instances.length === 0 ? empty : null}
      {instances.map((instance, index) => (
        <TaskRow
          key={instance.key}
          instance={instance}
          showDate={showDate}
          selected={instance.key === selectedKey}
          onOpen={onOpen}
          reorder={reorder.row(index)}
          listIds={ids}
        />
      ))}
    </div>
  );
}
