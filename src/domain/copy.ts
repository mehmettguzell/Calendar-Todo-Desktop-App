import { daysBetween, addDaysLocal, nowInstant } from "./datetime";
import { createId } from "./ids";
import type { Instant, LocalDate, Task } from "./types";

/**
 * Copying a task.
 *
 * A copy is a genuinely NEW task, not a second view of an old one — which is
 * why it does not violate the single-source-of-truth rule (spec section 3).
 * "Standup" on Monday and "Standup" on Thursday are two independent pieces of
 * work: finishing one must not finish the other. Wanting the *same* task to
 * appear on two days is a different wish, and `domain/extraDays.ts` answers it
 * without duplicating anything.
 *
 * What is deliberately NOT carried over: status, completion, snooze, focus
 * sessions, reminders and history. A copy starts its own life at TODO — the
 * point of copying yesterday's task is to do it again, not to have it already
 * marked done.
 *
 * Nor is the repeat rule. What is on screen when someone copies a repeating
 * task is one occurrence on one day, and that is what they mean to put
 * somewhere else; handing them a second endless series instead is a surprise
 * they would have to hunt down to undo.
 */
export interface CopyTarget {
  /** Day the copy lands on. Omitted = same day as the source. */
  dueDate?: LocalDate | null;
  /**
   * Start clock time for the copy. Omitted = same time as the source.
   *
   * Giving one settles the all-day question too: a task dropped on 10:00 is a
   * timed task, and a task dropped in the all-day strip (`null`) is not.
   */
  startTime?: string | null;
}

/** Injectable so tests get stable ids instead of random ones. */
export type IdFactory = () => string;

const defaultIds: IdFactory = () => createId("t");

/**
 * One task copied onto a (possibly) different day.
 *
 * A multi-day run keeps its *length* rather than its end date: a task booked
 * August 25-28 dropped on September 1 covers September 1-4, which is what
 * dragging a four-day block anywhere in a calendar has always meant.
 */
export function copyOfTask(
  source: Task,
  target: CopyTarget = {},
  at: Instant = nowInstant(),
  nextId: IdFactory = defaultIds,
): Task {
  const dueDate = target.dueDate !== undefined ? target.dueDate : source.dueDate;
  const startTime =
    target.startTime !== undefined ? target.startTime : source.startTime;

  return {
    ...source,
    id: nextId(),
    dueDate,
    endDate: shiftedEnd(source, dueDate),
    startTime,
    allDay: target.startTime === undefined ? source.allDay : target.startTime === null,
    // A copy that keeps a start time but loses its end would silently become a
    // point in time; shifting the end by the same amount keeps its duration.
    endTime: shiftedEndTime(source, startTime),
    recurrence: null,
    status: "TODO",
    completedAt: null,
    snoozedUntil: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A task and everything under it, copied as one unit.
 *
 * Subtasks follow their parent — a checklist copied without its checklist is
 * not a copy of anything. Only the root is re-dated; the children keep whatever
 * dates they carried, since a subtask due on its own day was scheduled on
 * purpose.
 */
export function copySubtree(
  tasks: Task[],
  rootId: string,
  target: CopyTarget = {},
  at: Instant = nowInstant(),
  nextId: IdFactory = defaultIds,
): Task[] {
  const root = tasks.find((t) => t.id === rootId && t.deletedAt === null);
  if (!root) return [];

  const rootCopy = copyOfTask(root, target, at, nextId);
  const out: Task[] = [rootCopy];
  // Breadth-first, so a child is always copied after the parent whose new id it
  // needs. `remap` carries old id -> new id across the whole walk.
  const remap = new Map<string, string>([[root.id, rootCopy.id]]);
  const queue: string[] = [root.id];

  while (queue.length > 0) {
    const parentId = queue.shift() as string;
    const children = tasks
      .filter((t) => t.parentId === parentId && t.deletedAt === null)
      .sort((a, b) => a.order - b.order);

    for (const child of children) {
      const copy = copyOfTask(child, {}, at, nextId);
      copy.parentId = remap.get(parentId) ?? null;
      remap.set(child.id, copy.id);
      out.push(copy);
      queue.push(child.id);
    }
  }
  return out;
}

/** Move the end date by the same number of days the start moved. */
function shiftedEnd(source: Task, dueDate: LocalDate | null): LocalDate | null {
  const end = source.endDate ?? null;
  if (!end || !source.dueDate || !dueDate) return dueDate ? end : null;
  if (end <= source.dueDate) return null;
  return addDaysLocal(dueDate, daysBetween(source.dueDate, end));
}

/** Move the end time by the same number of minutes the start moved. */
function shiftedEndTime(source: Task, startTime: string | null): string | null {
  if (!source.endTime || !source.startTime || !startTime) return source.endTime ?? null;
  if (startTime === source.startTime) return source.endTime;
  const delta = toMinutes(startTime) - toMinutes(source.startTime);
  const end = toMinutes(source.endTime) + delta;
  // A copy pushed past midnight clamps rather than wrapping into the day
  // before, which would read as an event that ends before it starts.
  if (end >= 24 * 60) return "23:59";
  if (end < 0) return "00:00";
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function toMinutes(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}
