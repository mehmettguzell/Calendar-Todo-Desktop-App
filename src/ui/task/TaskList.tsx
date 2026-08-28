import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Target, Unlink } from "lucide-react";
import { plansAcceptingTask } from "@/domain/task";
import type { Task, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState,
} from "@/ui/components/ContextMenu";
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
  const setParent = useStore((s) => s.setParent);
  const makePlan = useStore((s) => s.makePlan);
  const tasks = useStore((s) => s.db.tasks);
  const { t } = useI18n();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  /*
   * Right-click is where a task's relationship to the plans lives.
   *
   * It is the one gesture that costs the row nothing: a list of tasks has no
   * room for a "which plan?" control on every line, and a task that belongs to
   * no plan — most of them — should show no sign that plans exist.
   */
  const openMenu = (
    event: MouseEvent<HTMLDivElement>,
    instance: TaskInstance,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const { task } = instance;
    const items: ContextMenuItem[] = [];

    if (!(task.tags.includes("plan") && task.parentId === null)) {
      items.push({
        id: "make-plan",
        label: t("menuMakePlan"),
        icon: <Target size={14} />,
        onSelect: () => makePlan(task.id),
      });
    }

    for (const plan of plansAcceptingTask(tasks, task)) {
      items.push({
        id: `plan:${plan.id}`,
        label: t("menuFileUnderPlan", { title: plan.title }),
        icon: <Target size={14} />,
        onSelect: () => setParent(task.id, plan.id),
      });
    }

    if (task.parentId !== null) {
      const parent = tasks.find((each) => each.id === task.parentId);
      items.push({
        id: "detach",
        label: t("detachFromParent", { title: parent?.title ?? "" }),
        icon: <Unlink size={14} />,
        onSelect: () => setParent(task.id, null),
      });
    }

    if (items.length === 0) return;
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

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
          onContextMenu={openMenu}
        />
      ))}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
