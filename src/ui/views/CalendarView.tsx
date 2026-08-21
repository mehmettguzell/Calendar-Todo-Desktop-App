import { useMemo } from "react";
import { addDays, addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { fromLocalDate, toLocalDate } from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { groupByDate, useInstancesInRange, type Filters } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";

export type CalendarMode = "month" | "week" | "day";

/**
 * Month, week and day are three layouts over one query. They cannot disagree
 * with each other, or with the todo list, because none of them owns any data.
 */
export function CalendarView({
  mode,
  anchor,
  filters,
  onOpen,
  onQuickAdd,
}: {
  mode: CalendarMode;
  anchor: LocalDate;
  filters: Filters;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
}) {
  const settings = useStore((s) => s.db.settings);
  const now = useNow();
  const today = toLocalDate(now);
  const { from, to, days } = useMemo(
    () => calendarRange(mode, anchor, settings.weekStartsOn),
    [mode, anchor, settings.weekStartsOn],
  );

  const instances = useInstancesInRange(from, to, filters);
  const byDate = useMemo(() => groupByDate(instances), [instances]);

  if (mode === "month") {
    return (
      <MonthGrid
        anchor={anchor}
        today={today}
        weekStartsOn={settings.weekStartsOn}
        instancesByDate={byDate}
        onOpen={onOpen}
        onQuickAdd={(date) => onQuickAdd(date, null)}
      />
    );
  }

  return (
    <TimeGrid
      days={days}
      today={today}
      now={now}
      dayStartHour={settings.dayStartHour}
      dayEndHour={settings.dayEndHour}
      instancesByDate={byDate}
      onOpen={onOpen}
      onQuickAdd={onQuickAdd}
    />
  );
}

/** The visible window for a mode, including the month view's leading/trailing days. */
export function calendarRange(
  mode: CalendarMode,
  anchor: LocalDate,
  weekStartsOn: 0 | 1,
): { from: LocalDate; to: LocalDate; days: LocalDate[] } {
  const date = fromLocalDate(anchor);

  if (mode === "day") {
    return { from: anchor, to: anchor, days: [anchor] };
  }
  if (mode === "week") {
    const start = startOfWeek(date, { weekStartsOn });
    const days = Array.from({ length: 7 }, (_, i) => toLocalDate(addDays(start, i)));
    return { from: days[0] as LocalDate, to: days[6] as LocalDate, days };
  }
  const start = startOfWeek(startOfMonth(date), { weekStartsOn });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn });
  return { from: toLocalDate(start), to: toLocalDate(end), days: [] };
}

/** Move the anchor by one unit of the current mode. */
export function stepAnchor(mode: CalendarMode, anchor: LocalDate, direction: 1 | -1): LocalDate {
  const date = fromLocalDate(anchor);
  if (mode === "month") return toLocalDate(addMonths(date, direction));
  return toLocalDate(addDays(date, direction * (mode === "week" ? 7 : 1)));
}

export function calendarTitle(
  mode: CalendarMode,
  anchor: LocalDate,
  weekStartsOn: 0 | 1,
): string {
  const date = fromLocalDate(anchor);
  if (mode === "month") {
    return date.toLocaleDateString([], { month: "long", year: "numeric" });
  }
  if (mode === "day") {
    return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  const start = startOfWeek(date, { weekStartsOn });
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.getDate()} – ${end.getDate()} ${start.toLocaleDateString([], { month: "long", year: "numeric" })}`
    : `${start.toLocaleDateString([], { day: "numeric", month: "short" })} – ${end.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
}
