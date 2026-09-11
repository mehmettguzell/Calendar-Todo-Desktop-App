import { cn } from "@/lib/cn";
import { Checkbox } from "@/ui/components/primitives";
import { TaskRowActions } from "./row/TaskRowActions";
import { TaskRowMain } from "./row/TaskRowMain";
import { useTaskRow, type TaskRowInput } from "./row/useTaskRow";

/**
 * One task, as it appears in every list-shaped view.
 *
 * The row is intentionally the same component in Today, Todo, Search and Trash:
 * one task has one representation, so completing it anywhere behaves the same.
 */
export function TaskRow({
  selected,
  ...input
}: TaskRowInput & { selected?: boolean }) {
  const m = useTaskRow(input);

  return (
    <div
      className={cn(
        "task-row",
        "row-hover",
        m.done && "done",
        selected && "selected",
        m.picking && "picking",
        m.picked && "picked",
        m.dragClass,
      )}
      {...m.dragHandlers}
      onContextMenu={
        m.onContextMenu
          ? (event) => m.onContextMenu?.(event, m.instance)
          : undefined
      }
    >
      {m.picking ? (
        <label className="task-pick" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={m.picked}
            aria-label={m.t("bulkSelectAria", { title: m.task.title })}
            onChange={() => m.toggle()}
            onClick={(e) => {
              if (e.shiftKey) {
                e.preventDefault();
                m.toggle(true);
              }
            }}
          />
        </label>
      ) : null}

      <div className={cn("prio", m.task.priority)} aria-hidden />
      <div style={{ paddingTop: 1 }}>
        <Checkbox done={m.done} onToggle={() => m.toggleComplete(m.instance)} />
      </div>

      <TaskRowMain model={m} />
      <TaskRowActions model={m} />
    </div>
  );
}
