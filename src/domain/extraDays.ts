import { addDays, startOfWeek } from "date-fns";
import { fromLocalDate, toLocalDate } from "./datetime";
import { expandOccurrences } from "./recurrence";
import { spanEnd } from "./task";
import type { LocalDate, Recurrence, Task } from "./types";

/**
 * "Also put this task on Thursday."
 *
 * The tempting implementation is to copy the row onto the second day, and it is
 * the wrong one: two rows are two tasks, and the spec (section 3) is explicit
 * that one logical task stays one record. What the user is describing is a task
 * that *occurs* on several days — which is precisely what `Recurrence` already
 * models, and what `Occurrence` already gives per-day completion state for.
 *
 * So an extra day is expressed as a weekly rule bounded to the task's own week:
 *
 *     Wednesday task + "also Monday"
 *       -> dueDate  = Monday          (the series anchor is its first day)
 *          recurrence = WEEKLY, byWeekday [Mon, Wed], until = Wednesday
 *
 * Nothing new is stored, both days can be completed independently, the calendar
 * and the todo list agree by construction, and the whole thing round-trips:
 * unticking Monday hands back exactly the plain Wednesday task it started as.
 */
export type ExtraDaysAvailability =
  /** Usable. */
  | "ok"
  /** No date at all, so there is no week to spread it across. */
  | "unscheduled"
  /** Already a `dueDate`..`endDate` run — those days are contiguous by design. */
  | "spanning"
  /** Driven by a real repeat rule; that rule owns the dates, not this control. */
  | "series";

/** The seven dates of the week containing `date`. */
export function weekDatesOf(date: LocalDate, weekStartsOn: 0 | 1): LocalDate[] {
  const start = startOfWeek(fromLocalDate(date), { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => toLocalDate(addDays(start, i)));
}

/**
 * Is this rule one of ours?
 *
 * A weekly rule that stops inside the same week it starts in cannot be a
 * genuine repeat — it never gets to repeat. Anything else is the user's own
 * recurrence and is left alone: silently rewriting "every Tuesday forever" into
 * a single week because someone clicked a day chip would be data loss.
 */
export function isExtraDaysRule(
  task: Pick<Task, "dueDate" | "recurrence">,
  weekStartsOn: 0 | 1,
): boolean {
  const rule = task.recurrence;
  if (!rule || !task.dueDate) return false;
  if (rule.freq !== "WEEKLY" || rule.interval !== 1) return false;
  if (rule.count) return false;
  if (!rule.until) return false;
  const week = weekDatesOf(task.dueDate, weekStartsOn);
  return rule.until <= (week[6] as LocalDate);
}

export function extraDaysAvailability(
  task: Task,
  weekStartsOn: 0 | 1,
): ExtraDaysAvailability {
  if (!task.dueDate) return "unscheduled";
  if (task.recurrence) {
    return isExtraDaysRule(task, weekStartsOn) ? "ok" : "series";
  }
  return spanEnd(task) ? "spanning" : "ok";
}

/** Which days of its own week the task currently lands on. */
export function coveredWeekDates(task: Task, weekStartsOn: 0 | 1): LocalDate[] {
  if (!task.dueDate) return [];
  const week = weekDatesOf(task.dueDate, weekStartsOn);
  return expandOccurrences(task, week[0] as LocalDate, week[6] as LocalDate);
}

/** The schedule fields that make `task` land on exactly `dates`. */
export interface ExtraDaysPatch {
  dueDate: LocalDate;
  endDate: LocalDate | null;
  recurrence: Recurrence | null;
}

/**
 * Rewrite the task's schedule so it occurs on exactly `dates`.
 *
 * `dates` must all sit inside one week; anything outside the week of the first
 * date is dropped rather than quietly extending the rule past it. An empty
 * selection is treated as "keep the day it already had": a control that can
 * delete the task's only date by unticking a box is a trap.
 */
export function extraDaysPatch(
  task: Task,
  dates: LocalDate[],
  weekStartsOn: 0 | 1,
): ExtraDaysPatch {
  const anchorDay = task.dueDate;
  if (!anchorDay) throw new Error("extraDaysPatch needs a scheduled task");

  const week = new Set(weekDatesOf(anchorDay, weekStartsOn));
  const chosen = [...new Set(dates.filter((d) => week.has(d)))].sort();
  const effective = chosen.length > 0 ? chosen : [anchorDay];
  const first = effective[0] as LocalDate;

  if (effective.length === 1) {
    return {
      dueDate: first,
      // Back to an ordinary one-day task: the same shape it had before any
      // chip was ever ticked.
      endDate: task.recurrence ? null : (task.endDate ?? null),
      recurrence: null,
    };
  }

  return {
    dueDate: first,
    // A rule and a `dueDate`..`endDate` run are two controls over the same
    // dates; letting both speak at once is how a calendar starts lying.
    endDate: null,
    recurrence: {
      freq: "WEEKLY",
      interval: 1,
      byWeekday: [...new Set(effective.map((d) => fromLocalDate(d).getDay()))].sort(
        (a, b) => a - b,
      ),
      // Stopping on the last chosen day is what keeps this an "extra day in
      // this week" and not an accidental repeat forever.
      until: effective[effective.length - 1] as LocalDate,
      count: null,
    },
  };
}
