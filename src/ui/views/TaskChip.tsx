import type { Category, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";

/**
 * Compact task rendering for the month grid.
 * All-day tasks read as filled bars, timed tasks as a dot plus a start time —
 * the visual distinction the spec asks for in section 6.
 */
export function TaskChip({
  instance,
  category,
  onOpen,
}: {
  instance: TaskInstance;
  category: Category | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const { task } = instance;
  const allDay = task.allDay || !task.startTime;
  const color = category?.color ?? "var(--accent)";
  const done = instance.storedStatus === "COMPLETED";

  return (
    <button
      type="button"
      className={cn(
        "chip truncate",
        allDay && "allday",
        done && "done",
        instance.status === "OVERDUE" && "overdue",
      )}
      style={allDay ? { background: color } : undefined}
      title={task.title}
      onClick={() => onOpen(instance)}
    >
      {allDay ? null : <i className="chip-dot" style={{ background: color }} />}
      {allDay ? null : <span className="chip-time">{task.startTime}</span>}
      <span className="chip-title truncate">{task.title}</span>
    </button>
  );
}
