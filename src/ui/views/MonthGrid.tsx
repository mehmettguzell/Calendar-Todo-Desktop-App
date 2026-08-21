import { useMemo, useState } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Plus } from "lucide-react";
import { fromLocalDate, toLocalDate } from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useCategoryIndex } from "@/state/selectors";
import { TaskChip } from "./TaskChip";

const VISIBLE_PER_CELL = 3;

/** Month layout. Reads the same instance list as every other view. */
export function MonthGrid({
  anchor,
  today,
  weekStartsOn,
  instancesByDate,
  onOpen,
  onQuickAdd,
}: {
  anchor: LocalDate;
  today: LocalDate;
  weekStartsOn: 0 | 1;
  instancesByDate: Map<LocalDate, TaskInstance[]>;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate) => void;
}) {
  const categories = useCategoryIndex();
  const [expanded, setExpanded] = useState<LocalDate | null>(null);
  const anchorDate = fromLocalDate(anchor);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn });
    const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn });
    return eachDayOfInterval({ start, end });
  }, [anchor, weekStartsOn]);

  const headings = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 7 + ((i + weekStartsOn) % 7)).toLocaleDateString([], {
          weekday: "short",
        }),
      ),
    [weekStartsOn],
  );

  return (
    <div className="cal">
      <div className="cal-weekdays">
        {headings.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="month-grid">
        {days.map((day) => {
          const local = toLocalDate(day);
          const items = instancesByDate.get(local) ?? [];
          const showAll = expanded === local;
          const visible = showAll ? items : items.slice(0, VISIBLE_PER_CELL);
          const weekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <div
              key={local}
              className={cn(
                "month-cell",
                !isSameMonth(day, anchorDate) && "outside",
                weekend && isSameMonth(day, anchorDate) && "weekend",
                local === today && "today",
              )}
              onDoubleClick={() => onQuickAdd(local)}
            >
              <span className="month-daynum">{day.getDate()}</span>
              <button
                type="button"
                className="month-add"
                title="Add task on this day"
                onClick={() => onQuickAdd(local)}
              >
                <Plus size={13} />
              </button>

              {visible.map((instance) => (
                <TaskChip
                  key={instance.key}
                  instance={instance}
                  category={
                    instance.task.categoryId
                      ? (categories.get(instance.task.categoryId) ?? null)
                      : null
                  }
                  onOpen={onOpen}
                />
              ))}

              {items.length > VISIBLE_PER_CELL ? (
                <button
                  type="button"
                  className="chip-more"
                  onClick={() => setExpanded(showAll ? null : local)}
                >
                  {showAll ? "Show less" : `+${items.length - VISIBLE_PER_CELL} more`}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
