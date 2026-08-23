import { atTime, daysBetween, fromInstant, toLocalDate } from "./datetime";
import { instanceKey, occurrenceId } from "./ids";
import { expandOccurrences } from "./recurrence";
import type {
  Instant,
  LocalDate,
  Occurrence,
  StoredStatus,
  Task,
  TaskInstance,
  TaskSpan,
  TaskStatus,
} from "./types";

/**
 * Situational status, resolved against the clock.
 *
 * Precedence is deliberate:
 *   COMPLETED  — a finished task is never overdue.
 *   SNOOZED    — an explicit "not now" outranks the calendar (spec §5.4:
 *                snoozing must not read as completion, and it must not read
 *                as an unattended overdue item either).
 *   OVERDUE    — deadline passed with the task still open.
 *   otherwise  — whatever the user last chose (TODO / IN_PROGRESS).
 */
export function effectiveStatus(
  storedStatus: StoredStatus,
  deadline: Date | null,
  snoozedUntil: Instant | null,
  now: Date,
): TaskStatus {
  if (storedStatus === "COMPLETED") return "COMPLETED";
  if (snoozedUntil && fromInstant(snoozedUntil).getTime() > now.getTime()) return "SNOOZED";
  if (deadline && deadline.getTime() < now.getTime()) return "OVERDUE";
  return storedStatus;
}

/**
 * The moment a task stops being "on time".
 * All-day tasks are late once the day is over, timed tasks once they end
 * (or start, when no end time is given).
 *
 * A multi-day task has ONE deadline — the end of its last day — shared by every
 * date it is drawn on. Judging each day separately would paint the opening days
 * of a still-running August 25-28 task as OVERDUE while it is perfectly on time.
 */
export function deadlineOf(task: Task, date: LocalDate | null): Date | null {
  if (!date) return null;
  const lastDay = spanEnd(task) ?? date;
  const on = task.recurrence ? date : lastDay > date ? lastDay : date;
  if (task.allDay || !task.startTime) return atTime(on, "23:59");
  return atTime(on, task.endTime ?? task.startTime);
}

/** Last day a non-recurring task covers, or `null` when it covers only one. */
export function spanEnd(task: Pick<Task, "dueDate" | "endDate" | "recurrence">): LocalDate | null {
  if (task.recurrence || !task.dueDate) return null;
  const end = task.endDate ?? null;
  return end && end > task.dueDate ? end : null;
}

/** How this date sits inside the task's `dueDate`..`endDate` range. */
export function spanOf(task: Task, date: LocalDate | null): TaskSpan {
  const end = spanEnd(task);
  if (!end || !date || !task.dueDate) {
    return { length: 1, index: 0, isStart: true, isEnd: true };
  }
  const length = daysBetween(task.dueDate, end) + 1;
  const index = daysBetween(task.dueDate, date);
  return {
    length,
    index,
    isStart: index <= 0,
    isEnd: index >= length - 1,
  };
}

/** Resolve one task on one date into the shape every view consumes. */
export function toInstance(
  task: Task,
  date: LocalDate | null,
  occurrence: Occurrence | null,
  now: Date,
): TaskInstance {
  const isRecurring = task.recurrence !== null;
  const storedStatus = isRecurring && date ? (occurrence?.status ?? "TODO") : task.status;
  const completedAt = isRecurring && date ? (occurrence?.completedAt ?? null) : task.completedAt;
  const snoozedUntil = isRecurring && date ? (occurrence?.snoozedUntil ?? null) : task.snoozedUntil;

  const timed = !task.allDay && task.startTime !== null && date !== null;
  const span = spanOf(task, date);
  return {
    // Every rendered day of a multi-day task needs its own React key, but the
    // *mutation* target stays the single task row — see `refOf` in the store.
    key: instanceKey(task.id, date, isRecurring || span.length > 1),
    span,
    task,
    date,
    isRecurring,
    occurrence,
    storedStatus,
    status: effectiveStatus(storedStatus, deadlineOf(task, date), snoozedUntil, now),
    completedAt,
    snoozedUntil,
    startsAt: timed ? atTime(date, task.startTime) : null,
    endsAt: timed && task.endTime ? atTime(date, task.endTime) : null,
  };
}

/**
 * Every instance of `task` that lands inside `[from, to]`.
 * Unscheduled tasks produce nothing here — they belong to the Todo view only.
 */
export function instancesInRange(
  task: Task,
  from: LocalDate,
  to: LocalDate,
  occurrences: Map<string, Occurrence>,
  now: Date,
): TaskInstance[] {
  return expandOccurrences(task, from, to).map((date) =>
    toInstance(task, date, occurrences.get(occurrenceId(task.id, date)) ?? null, now),
  );
}

/**
 * The instance a Todo-style list should show for a task: its oldest still-open
 * occurrence, so an unfinished repeat surfaces before the next scheduled one.
 */
export function representativeInstance(
  task: Task,
  occurrences: Map<string, Occurrence>,
  now: Date,
): TaskInstance {
  if (!task.dueDate) return toInstance(task, null, null, now);
  if (!task.recurrence) return toInstance(task, task.dueDate, null, now);

  const horizon = toLocalDate(new Date(now.getTime() + 400 * 24 * 3600 * 1000));
  let fallback: TaskInstance | null = null;

  for (const date of expandOccurrences(task, task.dueDate, horizon)) {
    const occ = occurrences.get(occurrenceId(task.id, date)) ?? null;
    const instance = toInstance(task, date, occ, now);
    fallback ??= instance;
    if (instance.storedStatus !== "COMPLETED") return instance;
  }
  return fallback ?? toInstance(task, task.dueDate, null, now);
}

export function isOpen(status: TaskStatus): boolean {
  return status !== "COMPLETED";
}

export function isSubtask(task: Task): boolean {
  return task.parentId !== null;
}

/*
 * Status and priority carry no label maps here on purpose.
 *
 * A domain module that spells a word in one language is a module the UI cannot
 * translate. The names ARE the keys: `t("statusOVERDUE")`, `t("priorityHIGH")`.
 */
