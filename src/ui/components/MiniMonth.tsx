import { useMemo } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fromLocalDate, localeTag, toLocalDate, weekdayNames } from "@/domain/datetime";
import { useI18n } from "@/lib/i18n";
import type { LocalDate } from "@/domain/types";
import { cn } from "@/lib/cn";

/** Month overview in the sidebar; a dot marks days that hold at least one task. */
export function MiniMonth({
  anchor,
  selected,
  today,
  busyDates,
  weekStartsOn,
  onSelect,
  onAnchorChange,
}: {
  anchor: LocalDate;
  selected: LocalDate;
  today: LocalDate;
  busyDates: Set<LocalDate>;
  weekStartsOn: 0 | 1;
  onSelect: (date: LocalDate) => void;
  onAnchorChange: (date: LocalDate) => void;
}) {
  const { t, language } = useI18n();
  const anchorDate = fromLocalDate(anchor);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn });
    const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn });
    return eachDayOfInterval({ start, end });
  }, [anchor, weekStartsOn]);

  // The mini month used to spell its columns in English while the grid beside
  // it spelled them in Turkish. One source, one language.
  const headings = useMemo(() => {
    const names = weekdayNames("short");
    return Array.from(
      { length: 7 },
      (_, i) => (names[(i + weekStartsOn) % 7] ?? "").slice(0, 2),
    );
  }, [weekStartsOn, language]);

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ padding: "0 8px" }}>
        <span className="grow" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {anchorDate.toLocaleDateString(localeTag(), { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          className="btn ghost icon"
          aria-label={t("previous")}
          onClick={() => onAnchorChange(toLocalDate(addMonths(anchorDate, -1)))}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="btn ghost icon"
          aria-label={t("next")}
          onClick={() => onAnchorChange(toLocalDate(addMonths(anchorDate, 1)))}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="mini">
        {headings.map((initial, index) => (
          <span key={`${initial}-${index}`} className="head">
            {initial}
          </span>
        ))}
        {days.map((day) => {
          const local = toLocalDate(day);
          return (
            <button
              key={local}
              type="button"
              className={cn(
                !isSameMonth(day, anchorDate) && "outside",
                local === today && "today",
                local === selected && "selected",
                busyDates.has(local) && "has-tasks",
              )}
              onClick={() => onSelect(local)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
