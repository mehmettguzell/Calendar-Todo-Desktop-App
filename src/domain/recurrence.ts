import { addDays, addMonths, addYears, getDay, isAfter, isBefore } from "date-fns";
import { fromLocalDate, toLocalDate } from "./datetime";
import type { LocalDate, Recurrence, Task } from "./types";

/** Safety valve so a malformed rule can never spin forever. */
const MAX_STEPS = 3000;

export function describeRecurrence(rule: Recurrence | null): string {
  if (!rule) return "Does not repeat";
  const n = Math.max(1, rule.interval);
  const every = n === 1 ? "Every" : `Every ${n}`;
  let base: string;
  switch (rule.freq) {
    case "DAILY":
      base = `${every} ${n === 1 ? "day" : "days"}`;
      break;
    case "WEEKLY": {
      const days = rule.byWeekday?.length
        ? ` on ${rule.byWeekday
            .slice()
            .sort((a, b) => a - b)
            .map((d) => WEEKDAY_SHORT[d])
            .join(", ")}`
        : "";
      base = `${every} ${n === 1 ? "week" : "weeks"}${days}`;
      break;
    }
    case "MONTHLY":
      base = `${every} ${n === 1 ? "month" : "months"}`;
      break;
    case "YEARLY":
      base = `${every} ${n === 1 ? "year" : "years"}`;
      break;
  }
  if (rule.until) base += ` until ${rule.until}`;
  else if (rule.count) base += `, ${rule.count} times`;
  return base;
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Every date the series produces inside `[rangeStart, rangeEnd]`, inclusive.
 *
 * Occurrences are computed, never stored: a series stays one row no matter how
 * far the calendar is scrolled.
 */
export function expandOccurrences(
  task: Pick<Task, "dueDate" | "recurrence"> & Partial<Pick<Task, "endDate">>,
  rangeStart: LocalDate,
  rangeEnd: LocalDate,
): LocalDate[] {
  const { dueDate, recurrence } = task;
  if (!dueDate) return [];
  if (!recurrence) {
    // A task with an `endDate` occupies every day of `[dueDate, endDate]`, so
    // "August 25 - 28" shows up on all four days instead of only the first.
    // A recurring rule keeps its own single-day occurrences: `recurrence.until`
    // already bounds the series, and letting each repeat span days as well
    // would make two independent controls fight over the same dates.
    const last = task.endDate && task.endDate > dueDate ? task.endDate : dueDate;
    if (last === dueDate) {
      return dueDate >= rangeStart && dueDate <= rangeEnd ? [dueDate] : [];
    }
    return daysBetweenInclusive(
      dueDate > rangeStart ? dueDate : rangeStart,
      last < rangeEnd ? last : rangeEnd,
    );
  }

  const anchor = fromLocalDate(dueDate);
  const start = fromLocalDate(rangeStart);
  const end = fromLocalDate(rangeEnd);
  const until = recurrence.until ? fromLocalDate(recurrence.until) : null;
  const limit = recurrence.count && recurrence.count > 0 ? recurrence.count : null;

  const out: LocalDate[] = [];
  let produced = 0;

  for (const date of iterate(anchor, recurrence)) {
    if (until && isAfter(date, until)) break;
    if (limit !== null && produced >= limit) break;
    produced += 1;
    if (isAfter(date, end)) break;
    if (!isBefore(date, start)) out.push(toLocalDate(date));
  }
  return out;
}

/** The first occurrence strictly after `after`, or `null` if the series ended. */
export function nextOccurrenceAfter(
  task: Pick<Task, "dueDate" | "recurrence">,
  after: LocalDate,
): LocalDate | null {
  if (!task.dueDate) return null;
  if (!task.recurrence) return task.dueDate > after ? task.dueDate : null;

  const anchor = fromLocalDate(task.dueDate);
  const until = task.recurrence.until ? fromLocalDate(task.recurrence.until) : null;
  const limit = task.recurrence.count && task.recurrence.count > 0 ? task.recurrence.count : null;
  let produced = 0;

  for (const date of iterate(anchor, task.recurrence)) {
    if (until && isAfter(date, until)) return null;
    if (limit !== null && produced >= limit) return null;
    produced += 1;
    const local = toLocalDate(date);
    if (local > after) return local;
  }
  return null;
}

export function occursOn(
  task: Pick<Task, "dueDate" | "recurrence">,
  date: LocalDate,
): boolean {
  return expandOccurrences(task, date, date).length > 0;
}

/** Lazily walk the series from its anchor, oldest first. */
function* iterate(anchor: Date, rule: Recurrence): Generator<Date> {
  const interval = Math.max(1, Math.floor(rule.interval) || 1);

  if (rule.freq === "WEEKLY" && rule.byWeekday && rule.byWeekday.length > 0) {
    const weekdays = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
    // Walk to the Sunday of the anchor's week, then step week-blocks.
    const weekStart = addDays(anchor, -getDay(anchor));
    for (let step = 0, guard = 0; guard < MAX_STEPS; step += interval) {
      const base = addDays(weekStart, step * 7);
      for (const weekday of weekdays) {
        const date = addDays(base, weekday);
        if (isBefore(date, anchor)) continue;
        guard += 1;
        yield date;
      }
      guard += 1;
    }
    return;
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const offset = step * interval;
    switch (rule.freq) {
      case "DAILY":
        yield addDays(anchor, offset);
        break;
      case "WEEKLY":
        yield addDays(anchor, offset * 7);
        break;
      case "MONTHLY":
        yield addMonths(anchor, offset);
        break;
      case "YEARLY":
        yield addYears(anchor, offset);
        break;
    }
  }
}

/** Every `YYYY-MM-DD` from `from` to `to`, inclusive. Empty when `from > to`. */
function daysBetweenInclusive(from: LocalDate, to: LocalDate): LocalDate[] {
  if (from > to) return [];
  const out: LocalDate[] = [];
  let cursor = fromLocalDate(from);
  const end = fromLocalDate(to);
  let steps = 0;
  while (cursor.getTime() <= end.getTime() && steps < MAX_STEPS) {
    out.push(toLocalDate(cursor));
    cursor = addDays(cursor, 1);
    steps += 1;
  }
  return out;
}
