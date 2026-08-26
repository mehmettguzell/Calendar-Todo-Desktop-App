import { addHours, addMinutes, nextMonday, startOfDay } from "date-fns";
import {
  atTime,
  fromInstant,
  fromLocalDate,
  toInstant,
  toLocalDate,
  toLocalTime,
} from "./datetime";
import type {
  Instant,
  LocalDate,
  LocalTime,
  Settings,
  TaskInstance,
} from "./types";

export type SnoozePresetId =
  | "10m"
  | "30m"
  | "1h"
  | "3h"
  | "tomorrow"
  | "monday"
  | "custom";

export interface SnoozePreset {
  id: SnoozePresetId;
  /** Dictionary key for the label. The wording belongs to the UI, not here. */
  labelKey: string;
  /** Presets that jump to another day carry the task with them (spec §8). */
  movesDay: boolean;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { id: "10m", labelKey: "snooze10m", movesDay: false },
  { id: "30m", labelKey: "snooze30m", movesDay: false },
  { id: "1h", labelKey: "snooze1h", movesDay: false },
  { id: "3h", labelKey: "snooze3h", movesDay: false },
  { id: "tomorrow", labelKey: "snoozeTomorrow", movesDay: true },
  { id: "monday", labelKey: "snoozeMonday", movesDay: true },
  { id: "custom", labelKey: "snoozeCustom", movesDay: true },
];

export interface SnoozeOutcome {
  /** When the task/reminder becomes active again; `null` when nothing is left to wait for. */
  until: Instant | null;
  /**
   * Set when the task's own schedule has to move, i.e. the snooze target
   * lands on a different calendar day (spec §8: "Tomorrow" → Aug 25 14:00
   * becomes Aug 26 14:00). `null` means reminder-only postponement.
   */
  reschedule: { date: LocalDate; startTime: LocalTime | null } | null;
}

/**
 * Turn a snooze choice into a concrete outcome.
 *
 * Snooze and reschedule stay conceptually distinct: a snooze always postpones,
 * and only *additionally* reschedules when the postponement crosses into
 * another day — because a task cannot silently sit on yesterday's date while
 * its reminder waits for tomorrow.
 */
export function resolveSnooze(
  instance: TaskInstance,
  preset: SnoozePresetId,
  settings: Settings,
  now: Date,
  customTarget?: Date,
): SnoozeOutcome {
  const target = snoozeTarget(instance, preset, settings, now, customTarget);
  const anchorDate = instance.date;
  const targetDate = toLocalDate(target);

  // Suppressing a task until a moment that has already passed suppresses
  // nothing, and leaving a stale instant behind makes the row claim to be
  // SNOOZED for one render and then flip. A target in the past means "no
  // postponement", only the move below.
  const until = target.getTime() > now.getTime() ? toInstant(target) : null;

  // A recurring series is never moved by a snooze: shifting the anchor would
  // silently drag every future occurrence with it. Postpone this occurrence
  // and leave the rule alone.
  if (instance.isRecurring) return { until, reschedule: null };

  const isShortPreset =
    preset === "10m" || preset === "30m" || preset === "1h" || preset === "3h";

  if (isShortPreset) {
    // Short snoozes only postpone the notification/reminder.
    // They only reschedule when a task scheduled for today crosses past midnight.
    const isToday = anchorDate === toLocalDate(now);
    const crossesMidnight = isToday && targetDate > anchorDate;
    if (crossesMidnight) {
      const keepsTime =
        !instance.task.allDay && instance.task.startTime !== null;
      return {
        until,
        reschedule: {
          date: targetDate,
          startTime: keepsTime ? instance.task.startTime : null,
        },
      };
    }
    return { until, reschedule: null };
  }

  // Day-jumping presets (tomorrow, monday, custom) move the task to the target day.
  const keepsTime =
    preset === "custom"
      ? !instance.task.allDay
        ? toLocalTime(target)
        : null
      : !instance.task.allDay && instance.task.startTime !== null
        ? instance.task.startTime
        : null;

  return {
    until,
    reschedule: {
      date: targetDate,
      startTime: keepsTime,
    },
  };
}

/**
 * The date a preset would move `instance` to, or `null` when it only postpones
 * the reminder. Lets the menu label each option with the day it will produce.
 */
export function snoozePreviewDate(
  instance: TaskInstance,
  preset: SnoozePresetId,
  settings: Settings,
  now: Date,
  customTarget?: Date,
): LocalDate {
  return toLocalDate(
    snoozeTarget(instance, preset, settings, now, customTarget),
  );
}

function snoozeTarget(
  instance: TaskInstance,
  preset: SnoozePresetId,
  settings: Settings,
  now: Date,
  customTarget?: Date,
): Date {
  switch (preset) {
    case "10m":
      return addMinutes(now, 10);
    case "30m":
      return addMinutes(now, 30);
    case "1h":
      return addHours(now, 1);
    case "3h":
      return addHours(now, 3);
    case "tomorrow":
      return sameTimeOn(
        addDaysTo(dayAnchor(instance, now), 1),
        instance,
        settings,
      );
    case "monday":
      return sameTimeOn(
        nextMonday(dayAnchor(instance, now)),
        instance,
        settings,
      );
    case "custom":
      return customTarget ?? addHours(now, 1);
  }
}

/**
 * Day-jumping presets move relative to the task's day (or today if overdue/unscheduled).
 *
 * For overdue tasks or tasks without a date, snoozing until tomorrow means
 * tomorrow relative to today so the postponement is always in the future.
 */
function dayAnchor(instance: TaskInstance, now: Date): Date {
  const today = startOfDay(now);
  // No day of its own to move from: `fromLocalDate(null)` is an Invalid Date,
  // and every formatter downstream throws a RangeError on it.
  if (!instance.date) return today;
  const own = fromLocalDate(instance.date);
  // A task still ahead of us keeps its own day, so "Tomorrow" on an Aug 25 task
  // means Aug 26 even when read on Aug 20. A task already behind us anchors on
  // today instead — postponing to the day after a date that has passed would
  // schedule it into the past, which is not a postponement at all.
  return own.getTime() > today.getTime() ? own : today;
}

function addDaysTo(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Preserve the task's own time of day, falling back to the settings default. */
function sameTimeOn(
  day: Date,
  instance: TaskInstance,
  settings: Settings,
): Date {
  const time =
    !instance.task.allDay && instance.task.startTime
      ? instance.task.startTime
      : settings.allDayReminderTime;
  return atTime(toLocalDate(day), time);
}

export function describeSnooze(outcome: SnoozeOutcome): string {
  if (outcome.until === null) {
    return outcome.reschedule
      ? `moved to ${outcome.reschedule.date}`
      : "nothing to postpone";
  }
  const until = fromInstant(outcome.until);
  const when = `${toLocalDate(until)} ${toLocalTime(until)}`;
  return outcome.reschedule
    ? `moved to ${when}`
    : `reminder postponed to ${when}`;
}
