import type { Category, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";

/**
 * Compact task rendering for the month grid.
 * All-day tasks read as filled bars, timed tasks as a dot plus a start time —
 * the visual distinction the spec asks for in section 6.
 *
 * A task that runs `dueDate`..`endDate` is drawn on every day it covers. The
 * title repeats — month cells are separate boxes and a week break would leave an
 * anonymous bar otherwise — but the outer corners open up and the start time is
 * dropped after day one, so the run reads as one task rather than as four.
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
  const { task, span } = instance;
  const allDay = task.allDay || !task.startTime;
  const color = category?.color ?? "var(--accent)";
  const done = instance.storedStatus === "COMPLETED";
  const spanning = span.length > 1;
  const continues = spanning && !span.isStart;

  return (
    <button
      type="button"
      className={cn(
        "chip truncate",
        allDay && "allday",
        done && "done",
        instance.status === "OVERDUE" && "overdue",
        spanning && "spanning",
        spanning && !span.isStart && "span-continued",
        spanning && !span.isEnd && "span-continues",
      )}
      style={allDay ? { background: color } : undefined}
      title={
        spanning
          ? `${task.title} · ${task.dueDate} → ${task.endDate} (${span.index + 1}/${span.length})`
          : task.title
      }
      onClick={() => onOpen(instance)}
    >
      {allDay || continues ? null : (
        <i className="chip-dot" style={{ background: color }} />
      )}
      {allDay || continues ? null : (
        <span className="chip-time">{task.startTime}</span>
      )}
      <span className="chip-title truncate">{task.title}</span>
      {spanning && span.isStart && span.length > 1 ? (
        <span className="chip-span-count">{span.length}d</span>
      ) : null}
    </button>
  );
}
