import { addMinutes } from "date-fns";
import { atTime, fromInstant, localeTag } from "./datetime";
import { occurrenceId } from "./ids";
import { expandOccurrences, type Translate } from "./recurrence";
import { toInstance } from "./task";
import type {
  LocalDate,
  Occurrence,
  Reminder,
  Settings,
  Task,
  TaskInstance,
} from "./types";

/** The offsets the editor offers. Wording is the job of the UI, not this file. */
export const REMINDER_OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

/**
 * The instant a reminder should fire for one occurrence of its task.
 *
 * RELATIVE reminders are recomputed from the task's schedule on every read, so
 * rescheduling a task moves its reminders with it — no bookkeeping, and no way
 * for the two to drift apart.
 */
export function reminderInstantFor(
  reminder: Reminder,
  task: Task,
  date: LocalDate | null,
  settings: Settings,
): Date | null {
  if (reminder.kind === "ABSOLUTE") {
    return reminder.remindAt ? fromInstant(reminder.remindAt) : null;
  }
  if (!date) return null;
  const time = task.allDay || !task.startTime ? settings.allDayReminderTime : task.startTime;
  return addMinutes(atTime(date, time), -(reminder.offsetMinutes ?? 0));
}

/** "10 dakika once" / "10 minutes before", in the app language. */
export function describeOffset(minutes: number, t: Translate): string {
  if (minutes === 0) return t("reminderAtStart");
  if (minutes === 1440) return t("reminderDayBefore");
  if (minutes >= 60 && minutes % 60 === 0) {
    return t("reminderHoursBefore", { n: minutes / 60 });
  }
  return t("reminderMinutesBefore", { n: minutes });
}

export function describeReminder(reminder: Reminder, t: Translate): string {
  if (reminder.kind === "ABSOLUTE") {
    if (!reminder.remindAt) return t("reminderAtFixed");
    const at = fromInstant(reminder.remindAt);
    return t("reminderOnAt", {
      date: at.toLocaleDateString(localeTag()),
      time: at.toLocaleTimeString(localeTag(), {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }
  return describeOffset(reminder.offsetMinutes ?? 0, t);
}

export interface DueReminder {
  reminder: Reminder;
  instance: TaskInstance;
  firesAt: Date;
}

/**
 * Reminders that have come due but have not been delivered yet.
 *
 * A reminder is skipped when its occurrence is already completed or snoozed —
 * closing a task must silence it everywhere, which is only possible because
 * task, calendar entry and reminder all read the same row.
 */
export function collectDueReminders(
  reminders: Reminder[],
  tasks: Map<string, Task>,
  occurrences: Map<string, Occurrence>,
  settings: Settings,
  now: Date,
  lookbackDays = 7,
): DueReminder[] {
  const due: DueReminder[] = [];
  const from = shiftLocalDate(now, -lookbackDays);
  const to = shiftLocalDate(now, 1);

  for (const reminder of reminders) {
    if (reminder.status === "DISMISSED") continue;
    const task = tasks.get(reminder.taskId);
    if (!task || task.deletedAt) continue;

    if (reminder.snoozedUntil && fromInstant(reminder.snoozedUntil).getTime() > now.getTime()) {
      continue;
    }

    const isSeries = task.recurrence !== null;
    const candidateDates = candidateOccurrenceDates(task, reminder, from, to);
    for (const date of candidateDates) {
      // Already delivered, and not re-armed by a snooze.
      //
      // A one-off reminder is finished the moment it has FIRED — including a
      // multi-day task, which now yields one candidate date per day it covers
      // and would otherwise nag once for each of them. Only a recurring series
      // needs the per-date check, because there its reminder stays PENDING for
      // the next occurrence.
      const alreadyFired =
        reminder.snoozedUntil === null &&
        (isSeries
          ? date !== null &&
            reminder.lastFiredFor !== null &&
            date <= reminder.lastFiredFor
          : reminder.status === "FIRED");
      if (alreadyFired) continue;
      const firesAt = reminderInstantFor(reminder, task, date, settings);
      if (!firesAt || firesAt.getTime() > now.getTime()) continue;

      const occurrence =
        date !== null ? (occurrences.get(occurrenceId(task.id, date)) ?? null) : null;
      const instance = toInstance(task, date, occurrence, now);
      if (instance.status === "COMPLETED" || instance.status === "SNOOZED") continue;

      due.push({ reminder, instance, firesAt });
      break; // one delivery per reminder per tick
    }
  }
  return due;
}

function candidateOccurrenceDates(
  task: Task,
  reminder: Reminder,
  from: LocalDate,
  to: LocalDate,
): (LocalDate | null)[] {
  if (reminder.kind === "ABSOLUTE") {
    return [task.dueDate];
  }
  const dates = expandOccurrences(task, from, to);
  return dates.length > 0 ? dates : [];
}

function shiftLocalDate(now: Date, days: number): LocalDate {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
