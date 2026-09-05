import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { Flag } from "lucide-react";
import type { Category, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";

/**
 * Compact task rendering for the month grid.
 * All-day tasks read as tinted bars, timed tasks as a dot plus a start time —
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
  onContextMenu,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  instance: TaskInstance;
  category: Category | null;
  onOpen: (instance: TaskInstance) => void;
  onContextMenu?: (event: MouseEvent, instance: TaskInstance) => void;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (event: DragEvent, instance: TaskInstance) => void;
  onDragEnd?: () => void;
}) {
  const { task, span } = instance;
  const allDay = task.allDay || !task.startTime;
  const color = category?.color ?? "var(--accent)";
  const done = instance.storedStatus === "COMPLETED";
  // A deadline marker is the task on the day it is due by, not a day it
  // occupies, so it is never drawn as a filled bar or a span.
  const isDeadline = instance.isDeadline;
  const spanning = span.length > 1 && !isDeadline;
  const continues = spanning && !span.isStart;
  /*
   * A named checkpoint is drawn under its own name.
   *
   * "Backend bitecek" is what the user wrote down and what they are scanning
   * the 25th for; the project it belongs to is the one thing they already
   * know. The title still travels in the tooltip, so the chip never becomes a
   * label with no owner.
   */
  const label = instance.deadlineLabel ?? task.title;

  return (
    <button
      type="button"
      className={cn(
        "chip truncate",
        allDay && !isDeadline && "allday",
        isDeadline && "chip-deadline",
        // A named checkpoint of a plan, which is neither a task nor a day of
        // one. It gets its own mark so a glance at the month never reads it as
        // something to be done on the 25th — it is a date something is due by.
        instance.deadlineLabel ? "chip-checkpoint" : null,
        instance.deadlineMet && "is-met",
        done && "done",
        instance.status === "OVERDUE" && "overdue",
        spanning && "spanning",
        spanning && !span.isStart && "span-continued",
        spanning && !span.isEnd && "span-continues",
        dragging && "chip-dragging",
      )}
      /*
       * The category's colour is handed to CSS as a variable rather than
       * painted straight onto the background.
       *
       * A filled bar in an arbitrary category colour can never guarantee a
       * readable label on top of it — and it did not: in dark mode an all-day
       * chip was a solid blue slab with invisible text. CSS tints the colour
       * against the current surface and puts it in a stripe down the edge, so
       * the category is still identifiable and the title is always legible.
       */
      style={
        isDeadline
          ? { borderColor: color, color }
          : allDay
            ? ({ "--chip-color": color } as CSSProperties)
            : undefined
      }
      title={
        instance.deadlineLabel
          ? `${instance.deadlineLabel} · ${task.title}`
          : spanning
            ? `${task.title} · ${task.dueDate} → ${task.endDate} (${span.index + 1}/${span.length})`
            : task.title
      }
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, instance) : undefined}
      onDragEnd={onDragEnd}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, instance) : undefined}
      onClick={() => onOpen(instance)}
    >
      {isDeadline ? <Flag size={11} className="chip-flag" aria-hidden /> : null}
      {allDay || continues || isDeadline ? null : (
        <i className="chip-dot" style={{ background: color }} />
      )}
      {allDay || continues || isDeadline ? null : (
        <span className="chip-time">{task.startTime}</span>
      )}
      <span className="chip-title truncate">{label}</span>
      {spanning && span.isStart && span.length > 1 ? (
        <span className="chip-span-count">{span.length}d</span>
      ) : null}
    </button>
  );
}
