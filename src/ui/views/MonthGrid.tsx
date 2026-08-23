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
import { fromLocalDate, localeTag, toLocalDate } from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useCategoryIndex } from "@/state/selectors";
import { ContextMenu } from "@/ui/components/ContextMenu";
import { TaskChip } from "./TaskChip";
import { useCalendarInteractions } from "./calendarInteractions";

const VISIBLE_PER_CELL = 3;

/** Month layout. Reads the same instance list as every other view. */
export function MonthGrid({
  anchor,
  today,
  weekStartsOn,
  instancesByDate,
  selectedDate,
  onSelectDate,
  onOpen,
  onQuickAdd,
}: {
  anchor: LocalDate;
  today: LocalDate;
  weekStartsOn: 0 | 1;
  instancesByDate: Map<LocalDate, TaskInstance[]>;
  /** The day keyboard paste lands on. Picked by clicking a cell. */
  selectedDate: LocalDate | null;
  onSelectDate: (date: LocalDate) => void;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate) => void;
}) {
  const categories = useCategoryIndex();
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState<LocalDate | null>(null);
  const anchorDate = fromLocalDate(anchor);
  const gestures = useCalendarInteractions({
    onOpen,
    onQuickAdd: (date) => onQuickAdd(date),
  });

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn });
    const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn });
    return eachDayOfInterval({ start, end });
  }, [anchor, weekStartsOn]);

  const headings = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 7 + ((i + weekStartsOn) % 7)).toLocaleDateString(localeTag(), {
          weekday: "short",
        }),
      ),
    [weekStartsOn, language],
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
                local === selectedDate && "day-selected",
                gestures.dropTarget === local && "drop-target",
              )}
              // Clicking a day picks it; that is the whole paste target model —
              // "where does Ctrl+V go" has to have a visible answer.
              onClick={() => onSelectDate(local)}
              onDoubleClick={() => onQuickAdd(local)}
              onContextMenu={(e) => {
                onSelectDate(local);
                gestures.openDayMenu(e, local);
              }}
              onDragOver={(e) => {
                if (!gestures.isDragging()) return;
                e.preventDefault();
                e.dataTransfer.dropEffect =
                  e.ctrlKey || e.altKey || e.metaKey ? "copy" : "move";
                if (gestures.dropTarget !== local) gestures.setDropTarget(local);
              }}
              onDragLeave={() => {
                if (gestures.dropTarget === local) gestures.setDropTarget(null);
              }}
              onDrop={(e) => gestures.dropOn(e, local)}
            >
              <span className="month-daynum">{day.getDate()}</span>
              <button
                type="button"
                className="month-add"
                title={t("addTaskOnDay")}
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickAdd(local);
                }}
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
                  onContextMenu={gestures.openTaskMenu}
                  // A series is laid out by its rule, so there is nothing here
                  // to drag: dropping one occurrence somewhere else would move
                  // every other one with it. Its copies are still one
                  // right-click away.
                  draggable={!instance.isRecurring}
                  dragging={gestures.dragging?.key === instance.key}
                  onDragStart={gestures.startDrag}
                  onDragEnd={gestures.endDrag}
                />
              ))}

              {items.length > VISIBLE_PER_CELL ? (
                <button
                  type="button"
                  className="chip-more"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(showAll ? null : local);
                  }}
                >
                  {showAll
                    ? t("showLess")
                    : t("moreCount", { n: items.length - VISIBLE_PER_CELL })}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <ContextMenu state={gestures.menu} onClose={gestures.closeMenu} />
    </div>
  );
}
