import type { CSSProperties } from "react";
import type { Category, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";

/** What a chip is, before anything is drawn: the questions the look turns on. */
export interface ChipFacts {
  allDay: boolean;
  color: string;
  done: boolean;
  /** The task on the day it is due by, not a day it occupies. */
  isDeadline: boolean;
  spanning: boolean;
  /** A middle or last day of a run, where the time is dropped. */
  continues: boolean;
  label: string;
}

export function chipFacts(
  instance: TaskInstance,
  category: Category | null,
): ChipFacts {
  const { task, span } = instance;
  const isDeadline = instance.isDeadline;
  const spanning = span.length > 1 && !isDeadline;

  return {
    allDay: task.allDay || !task.startTime,
    color: category?.color ?? "var(--accent)",
    done: instance.storedStatus === "COMPLETED",
    isDeadline,
    spanning,
    continues: spanning && !span.isStart,
    /*
     * A named checkpoint is drawn under its own name.
     *
     * "Backend bitecek" is what the user wrote down and what they are scanning
     * the 25th for; the project it belongs to is the one thing they already
     * know. The title still travels in the tooltip, so the chip never becomes
     * a label with no owner.
     */
    label: instance.deadlineLabel ?? task.title,
  };
}

export interface ChipFlags {
  dragging: boolean;
  picking: boolean;
  picked: boolean;
}

export function chipClassName(
  instance: TaskInstance,
  facts: ChipFacts,
  flags: ChipFlags,
): string {
  return cn(
    "chip truncate",
    kindClasses(instance, facts),
    stateClasses(instance, facts, flags),
    spanClasses(instance, facts),
  );
}

/** What sort of thing the chip stands for. */
function kindClasses(instance: TaskInstance, facts: ChipFacts): string {
  return cn(
    facts.allDay && !facts.isDeadline && "allday",
    facts.isDeadline && "chip-deadline",
    // A named checkpoint of a plan, which is neither a task nor a day of one.
    // It gets its own mark so a glance at the month never reads it as
    // something to be done on the 25th — it is a date something is due by.
    instance.deadlineLabel && "chip-checkpoint",
  );
}

/** Where it stands, and what the user is currently doing to it. */
function stateClasses(
  instance: TaskInstance,
  facts: ChipFacts,
  flags: ChipFlags,
): string {
  return cn(
    instance.deadlineMet && "is-met",
    facts.done && "done",
    instance.status === "OVERDUE" && "overdue",
    flags.dragging && "chip-dragging",
    flags.picking && "picking",
    flags.picked && "picked",
  );
}

/** Which corners open up, so a run of days reads as one task. */
function spanClasses(instance: TaskInstance, facts: ChipFacts): string {
  const { span } = instance;
  return cn(
    facts.spanning && "spanning",
    facts.spanning && !span.isStart && "span-continued",
    facts.spanning && !span.isEnd && "span-continues",
  );
}

/**
 * The category's colour is handed to CSS as a variable rather than painted
 * straight onto the background.
 *
 * A filled bar in an arbitrary category colour can never guarantee a readable
 * label on top of it — and it did not: in dark mode an all-day chip was a solid
 * blue slab with invisible text. CSS tints the colour against the current
 * surface and puts it in a stripe down the edge, so the category is still
 * identifiable and the title is always legible.
 */
export function chipStyle(facts: ChipFacts): CSSProperties | undefined {
  if (facts.isDeadline) return { borderColor: facts.color, color: facts.color };
  if (facts.allDay) return { "--chip-color": facts.color } as CSSProperties;
  return undefined;
}

/** Everything the chip had no room to say. */
export function chipTitle(instance: TaskInstance, facts: ChipFacts): string {
  const { task, span } = instance;
  if (instance.deadlineLabel) return `${instance.deadlineLabel} · ${task.title}`;
  if (!facts.spanning) return task.title;
  const position = `${span.index + 1}/${span.length}`;
  return `${task.title} · ${task.dueDate} → ${task.endDate} (${position})`;
}
