import type { DragEvent, MouseEvent } from "react";
import { Flag } from "lucide-react";
import type { Category, TaskInstance } from "@/domain/types";
import { usePickGesture } from "@/ui/task/usePickGesture";
import {
  chipClassName,
  chipFacts,
  chipStyle,
  chipTitle,
} from "./taskChipLook";

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
  listIds,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  instance: TaskInstance;
  category: Category | null;
  onOpen: (instance: TaskInstance) => void;
  onContextMenu?: (event: MouseEvent, instance: TaskInstance) => void;
  /**
   * The chips drawn beside this one, in order — what a Shift-click measures
   * across. A day cell's worth, never the whole month: a range spanning two
   * days of a grid is not a range anybody can see.
   */
  listIds?: string[];
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (event: DragEvent, instance: TaskInstance) => void;
  onDragEnd?: () => void;
}) {
  const { task, span } = instance;
  const facts = chipFacts(instance, category);

  /*
   * A chip is picked the way a row is.
   *
   * Not with a checkbox: there is no room for one on a bar this size, and the
   * month grid would turn into a form. The mode itself is the affordance —
   * once it is on, a click picks instead of opens, and a picked chip is
   * outlined. A modifier click does the same without the mode, exactly as in
   * every list.
   *
   * Deadline markers stay out of it. Picking one would quietly pick the plan
   * it belongs to, and "delete the 4 things I picked" would take a whole
   * project with it.
   */
  const { picking, picked, onClickCapture } = usePickGesture({
    taskId: task.id,
    listIds,
    enabled: !instance.deadlineOnly,
  });

  const plain = !facts.allDay && !facts.continues && !facts.isDeadline;

  return (
    <button
      type="button"
      className={chipClassName(instance, facts, { dragging, picking, picked })}
      style={chipStyle(facts)}
      title={chipTitle(instance, facts)}
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, instance) : undefined}
      onDragEnd={onDragEnd}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, instance) : undefined}
      onClick={(e) => {
        if (onClickCapture(e)) return;
        onOpen(instance);
      }}
    >
      {facts.isDeadline ? <Flag size={11} className="chip-flag" aria-hidden /> : null}
      {plain ? <i className="chip-dot" style={{ background: facts.color }} /> : null}
      {plain ? <span className="chip-time">{task.startTime}</span> : null}
      <span className="chip-title truncate">{facts.label}</span>
      {facts.spanning && span.isStart ? (
        <span className="chip-span-count">{span.length}d</span>
      ) : null}
    </button>
  );
}
