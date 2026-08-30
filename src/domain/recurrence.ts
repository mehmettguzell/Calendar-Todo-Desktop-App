import {
  addDays,
  addMonths,
  addYears,
  getDate,
  getDay,
  getDaysInMonth,
  isAfter,
  isBefore,
  lastDayOfMonth,
  setDate,
  startOfMonth,
} from "date-fns";
import { fromLocalDate, toLocalDate } from "./datetime";
import type { LocalDate, Recurrence, Task } from "./types";

/** Safety valve so a malformed rule can never spin forever. */
const MAX_STEPS = 3000;

/**
 * The dictionary keys the domain layer is allowed to ask for.
 *
 * Spelled out rather than left as `string`, so that a key renamed in the
 * dictionary breaks this file at compile time instead of quietly rendering the
 * key itself to a user.
 */
export type DomainTextKey =
  | "formNoRepeat"
  | "repeatEveryDay"
  | "repeatEveryNDays"
  | "repeatEveryWeek"
  | "repeatEveryNWeeks"
  | "repeatEveryMonth"
  | "repeatEveryNMonths"
  | "repeatEveryYear"
  | "repeatEveryNYears"
  | "repeatOnDays"
  | "repeatOnMonthDay"
  | "repeatOnMonthDayShort"
  | "repeatOnLastDay"
  | "repeatOnNthWeekday"
  | "monthPos1"
  | "monthPos2"
  | "monthPos3"
  | "monthPos4"
  | "monthPosLast"
  | "repeatUntil"
  | "repeatTimes"
  | "reminderAtStart"
  | "reminderDayBefore"
  | "reminderHoursBefore"
  | "reminderMinutesBefore"
  | "reminderAtFixed"
  | "reminderOnAt";

/**
 * Look-up used to describe a rule. Passed in rather than imported so the domain
 * layer goes on knowing nothing about the dictionary or the UI.
 */
export type Translate = (
  key: DomainTextKey,
  params?: Record<string, string | number>,
) => string;

/**
 * "3rd" is a word in English and a numeral in Turkish, so the position is
 * looked up whole rather than built by gluing a suffix onto a digit.
 */
const POSITION_KEYS: Record<number, DomainTextKey> = {
  1: "monthPos1",
  2: "monthPos2",
  3: "monthPos3",
  4: "monthPos4",
  [-1]: "monthPosLast",
};

/**
 * The three shapes a monthly rule can take.
 *
 * A closed set rather than raw `byMonthDay`/`bySetPos`, because those two
 * fields can be combined into states that mean nothing ("the last day, but
 * also the 3rd Tuesday"). The editor picks a mode; `monthlyRuleFor` is the one
 * place that knows how a mode is spelled out in the stored rule.
 */
export type MonthlyMode = "DAY_OF_MONTH" | "LAST_DAY" | "NTH_WEEKDAY";

/** Which of the three a stored rule is expressing. */
export function monthlyModeOf(rule: Recurrence): MonthlyMode {
  if (rule.bySetPos != null && rule.byWeekday?.length) return "NTH_WEEKDAY";
  if (rule.byMonthDay === -1) return "LAST_DAY";
  return "DAY_OF_MONTH";
}

/**
 * `1`-`4` for the first through fourth of that weekday in the month, `-1` when
 * the date sits in a fifth week — there is no fifth Tuesday in most months, so
 * "the last Tuesday" is the only reading that survives every month.
 */
export function weekdayPositionInMonth(date: LocalDate): number {
  const position = Math.ceil(getDate(fromLocalDate(date)) / 7);
  return position > 4 ? -1 : position;
}

/**
 * The fields a mode needs, read off the anchor.
 *
 * Returns every monthly field on every call — including the ones it clears —
 * so switching modes can never leave the leftovers of the previous one behind.
 */
export function monthlyRuleFor(
  mode: MonthlyMode,
  anchor: LocalDate,
): Pick<Recurrence, "byMonthDay" | "bySetPos" | "byWeekday"> {
  switch (mode) {
    case "LAST_DAY":
      return { byMonthDay: -1, bySetPos: null, byWeekday: [] };
    case "NTH_WEEKDAY":
      return {
        byMonthDay: null,
        bySetPos: weekdayPositionInMonth(anchor),
        byWeekday: [getDay(fromLocalDate(anchor))],
      };
    case "DAY_OF_MONTH":
      // `null` rather than the anchor's day: an undated rule still has to mean
      // something, and "follow the anchor" is the only answer that keeps
      // working when the task is later moved to another date.
      return { byMonthDay: null, bySetPos: null, byWeekday: [] };
  }
}

/**
 * "Her hafta - Pzt, Per" / "Every week on Mon, Thu".
 *
 * Assembled from whole phrases rather than glued-together words: word order is
 * not the same in every language, and "every 3 days" reverses into "her 3 gunde
 * bir" — the number lands somewhere else entirely, which only the dictionary
 * can know.
 *
 * `anchor` is the task's due date. A monthly rule carries no day of its own —
 * it repeats on whatever day of the month the anchor happens to fall — so
 * without it the sentence can only say "every month" and leave the user to
 * guess. Optional because a task may not have a date yet.
 */
export function describeRecurrence(
  rule: Recurrence | null,
  t: Translate,
  weekdayNames: string[],
  anchor?: LocalDate | null,
): string {
  if (!rule) return t("formNoRepeat");
  const n = Math.max(1, rule.interval);
  const single = n === 1;

  let base: string;
  switch (rule.freq) {
    case "DAILY":
      base = single ? t("repeatEveryDay") : t("repeatEveryNDays", { n });
      break;
    case "WEEKLY": {
      base = single ? t("repeatEveryWeek") : t("repeatEveryNWeeks", { n });
      if (rule.byWeekday?.length) {
        const days = rule.byWeekday
          .slice()
          .sort((a, b) => a - b)
          .map((d) => weekdayNames[d] ?? "")
          .filter(Boolean)
          .join(", ");
        if (days) base = t("repeatOnDays", { base, days });
      }
      break;
    }
    case "MONTHLY": {
      base = single ? t("repeatEveryMonth") : t("repeatEveryNMonths", { n });
      const mode = monthlyModeOf(rule);
      if (mode === "LAST_DAY") {
        base = t("repeatOnLastDay", { base });
      } else if (mode === "NTH_WEEKDAY") {
        const weekday = rule.byWeekday?.[0];
        const day = weekday === undefined ? "" : (weekdayNames[weekday] ?? "");
        const posKey = rule.bySetPos == null ? undefined : POSITION_KEYS[rule.bySetPos];
        if (day && posKey) base = t("repeatOnNthWeekday", { base, pos: t(posKey), day });
      } else {
        const day = rule.byMonthDay ?? (anchor ? getDate(fromLocalDate(anchor)) : null);
        if (day !== null) {
          // 29, 30 and 31 do not exist in every month. The series pulls those
          // back to the last day rather than skipping the month, so the
          // sentence says as much instead of letting February be a surprise.
          base = day > 28
            ? t("repeatOnMonthDayShort", { base, day })
            : t("repeatOnMonthDay", { base, day });
        }
      }
      break;
    }
    case "YEARLY":
      base = single ? t("repeatEveryYear") : t("repeatEveryNYears", { n });
      break;
  }

  if (rule.until) return t("repeatUntil", { base, date: rule.until });
  if (rule.count) return t("repeatTimes", { base, n: rule.count });
  return base;
}

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

  if (rule.freq === "MONTHLY" && (rule.byMonthDay != null || rule.bySetPos != null)) {
    // Walked month by month rather than by adding months to the anchor: "the
    // last Tuesday" is a different day in every month, so there is no fixed
    // offset from the anchor to add.
    const firstMonth = startOfMonth(anchor);
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const date = resolveInMonth(addMonths(firstMonth, step * interval), rule);
      // The chosen day can land before the anchor in the anchor's own month
      // ("the 1st Monday" on a task dated the 20th). Skipping rather than
      // yielding keeps a series from starting in its own past.
      if (isBefore(date, anchor)) continue;
      yield date;
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
        // A rule with no monthly fields of its own repeats on the anchor's day
        // of the month. `addMonths` pulls the 31st back to the 28th in
        // February and returns to the 31st in March, because every step is
        // measured from the anchor rather than from the previous occurrence.
        yield addMonths(anchor, offset);
        break;
      case "YEARLY":
        yield addYears(anchor, offset);
        break;
    }
  }
}

/** The one day `month` contributes to a rule that names its own day. */
function resolveInMonth(month: Date, rule: Recurrence): Date {
  const weekday = rule.byWeekday?.[0];
  if (rule.bySetPos != null && weekday !== undefined) {
    return nthWeekdayOfMonth(month, weekday, rule.bySetPos);
  }
  if (rule.byMonthDay === -1) return lastDayOfMonth(month);
  return clampToMonth(month, rule.byMonthDay ?? getDate(month));
}

/**
 * The `position`-th `weekday` of `month`; `-1` means the last one.
 *
 * Positions 1-4 always exist — the shortest month is 28 days, exactly four of
 * each weekday — which is why `bySetPos` is never allowed to be 5.
 */
function nthWeekdayOfMonth(month: Date, weekday: number, position: number): Date {
  if (position < 0) {
    const last = lastDayOfMonth(month);
    return addDays(last, -((getDay(last) - weekday + 7) % 7));
  }
  const first = startOfMonth(month);
  const offset = (weekday - getDay(first) + 7) % 7;
  return addDays(first, offset + (position - 1) * 7);
}

/** `day` of `month`, pulled back to the last day when the month is shorter. */
function clampToMonth(month: Date, day: number): Date {
  return setDate(startOfMonth(month), Math.min(day, getDaysInMonth(month)));
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
