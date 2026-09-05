import { useMemo } from "react";
import { fromLocalDate, localeTag } from "@/domain/datetime";
import {
  coveredWeekDates,
  extraDaysAvailability,
  extraDaysPatch,
  weekDatesOf,
} from "@/domain/extraDays";
import type { LocalDate, Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useStore } from "@/state/store";

const UNAVAILABLE_HINT: Record<string, TranslationKey> = {
  unscheduled: "extraDaysUnscheduled",
  spanning: "extraDaysSpanning",
  series: "extraDaysSeries",
};

/**
 * "Put this on Thursday as well."
 *
 * Seven chips, one per day of the task's own week, and ticking one does not
 * copy anything: the task starts occurring on that day too, keeping one record
 * and gaining independent completion state per day. `domain/extraDays.ts`
 * explains how, and why that is the answer rather than a duplicate row.
 */
export function ExtraDaysPicker({ task }: { task: Task }) {
  const weekStartsOn = useStore((s) => s.db.settings.weekStartsOn);
  const updateTask = useStore((s) => s.updateTask);
  const { t } = useI18n();

  const availability = extraDaysAvailability(task, weekStartsOn);
  const week = useMemo(
    () => (task.dueDate ? weekDatesOf(task.dueDate, weekStartsOn) : []),
    [task.dueDate, weekStartsOn],
  );
  const covered = useMemo(
    () => new Set(coveredWeekDates(task, weekStartsOn)),
    [task, weekStartsOn],
  );

  if (availability !== "ok") {
    return (
      <p className="faint" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
        {t(UNAVAILABLE_HINT[availability] ?? "extraDaysUnscheduled")}
      </p>
    );
  }

  const toggle = (date: LocalDate) => {
    const next = covered.has(date)
      ? [...covered].filter((d) => d !== date)
      : [...covered, date];
    updateTask(
      task.id,
      extraDaysPatch(task, next, weekStartsOn),
      covered.has(date) ? `Removed from ${date}` : `Also on ${date}`,
    );
  };

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="weekday-chips">
        {week.map((date) => {
          const on = covered.has(date);
          // The last remaining day cannot be taken away: a control that can
          // leave a task with no date at all is a trap, not a shortcut.
          const locked = on && covered.size === 1;
          const day = fromLocalDate(date);
          return (
            <button
              key={date}
              type="button"
              className={cn("weekday-chip", on && "on", locked && "locked")}
              aria-pressed={on}
              disabled={locked}
              title={day.toLocaleDateString(localeTag(), {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              onClick={() => toggle(date)}
            >
              <span className="weekday-chip-dow">
                {day.toLocaleDateString(localeTag(), { weekday: "short" })}
              </span>
              <span className="weekday-chip-dom">{day.getDate()}</span>
            </button>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: "var(--text-2xs)", margin: 0 }}>
        {t("extraDaysHint")}
      </p>
    </div>
  );
}
