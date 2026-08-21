import { addHours, addMinutes, nextMonday, startOfDay } from "date-fns";
import {
  atTime,
  fromInstant,
  fromLocalDate,
  toInstant,
  toLocalDate,
  toLocalTime,
} from "./datetime";
import type { Instant, LocalDate, LocalTime, Settings, TaskInstance } from "./types";

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
  label: string;
  /** Presets that jump to another day carry the task with them (spec §8). */
  movesDay: boolean;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { id: "10m", label: "10 minutes", movesDay: false },
  { id: "30m", label: "30 minutes", movesDay: false },
  { id: "1h", label: "1 hour", movesDay: false },
  { id: "3h", label: "3 hours", movesDay: false },
  { id: "tomorrow", label: "Tomorrow", movesDay: true },
  { id: "monday", label: "Monday", movesDay: true },
  { id: "custom", label: "Custom…", movesDay: true },
];

export interface SnoozeOutcome {
  /** When the task/reminder becomes active again. */
  until: Instant;
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

  // A recurring series is never moved by a snooze: shifting the anchor would
  // silently drag every future occurrence with it. Postpone this occurrence
  // and leave the rule alone.
  if (instance.isRecurring) return { until: toInstant(target), reschedule: null };

  const crossesDay = anchorDate === null || targetDate !== anchorDate;
  if (!crossesDay) return { until: toInstant(target), reschedule: null };

  // Keep the clock time the task already had; only the day moves.
  const keepsTime = !instance.task.allDay && instance.task.startTime !== null;
  return {
    until: toInstant(target),
    reschedule: {
      date: targetDate,
      startTime: keepsTime ? instance.task.startTime : null,
    },
  };
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
      return sameTimeOn(addDaysTo(dayAnchor(instance, now), 1), instance, settings);
    case "monday":
      return sameTimeOn(nextMonday(dayAnchor(instance, now)), instance, settings);
    case "custom":
      return customTarget ?? addHours(now, 1);
  }
}

/** Day-jumping presets move relative to the task's own day, not the clock. */
function dayAnchor(instance: TaskInstance, now: Date): Date {
  if (!instance.date) return startOfDay(now);
  const taskDay = fromLocalDate(instance.date);
  return taskDay.getTime() < startOfDay(now).getTime() ? startOfDay(now) : taskDay;
}

function addDaysTo(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Preserve the task's own time of day, falling back to the settings default. */
function sameTimeOn(day: Date, instance: TaskInstance, settings: Settings): Date {
  const time =
    !instance.task.allDay && instance.task.startTime
      ? instance.task.startTime
      : settings.allDayReminderTime;
  return atTime(toLocalDate(day), time);
}

export function describeSnooze(outcome: SnoozeOutcome): string {
  const until = fromInstant(outcome.until);
  const when = `${toLocalDate(until)} ${toLocalTime(until)}`;
  return outcome.reschedule ? `moved to ${when}` : `reminder postponed to ${when}`;
}
