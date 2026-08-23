import { useEffect, useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import {
  durationMinutes,
  localeTag,
  minutesFromMidnight,
  minutesToTime,
  toLocalDate,
} from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useCategoryIndex } from "@/state/selectors";
import { ContextMenu } from "@/ui/components/ContextMenu";
import { TaskChip } from "./TaskChip";
import { useCalendarInteractions } from "./calendarInteractions";

const GUTTER = 56;
const HOUR_H = 52;
const MIN_EVENT_MINUTES = 30;
const DEFAULT_EVENT_MINUTES = 60;

/**
 * The week and day layouts: the same grid with a different number of columns.
 * All-day tasks sit in a dedicated strip above the hour grid so they never
 * masquerade as timed work (spec section 6).
 */
export function TimeGrid({
  days,
  today,
  now,
  dayStartHour,
  dayEndHour,
  instancesByDate,
  selectedDate,
  onSelectDate,
  onOpen,
  onQuickAdd,
}: {
  days: LocalDate[];
  today: LocalDate;
  now: Date;
  dayStartHour: number;
  dayEndHour: number;
  instancesByDate: Map<LocalDate, TaskInstance[]>;
  /** The day keyboard paste lands on. Picked by clicking a column heading. */
  selectedDate: LocalDate | null;
  onSelectDate: (date: LocalDate) => void;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
}) {
  const categories = useCategoryIndex();
  const { t } = useI18n();
  const gestures = useCalendarInteractions({ onOpen, onQuickAdd });
  const bodyRef = useRef<HTMLDivElement>(null);
  const hours = useMemo(
    () => Array.from({ length: dayEndHour - dayStartHour + 1 }, (_, i) => dayStartHour + i),
    [dayStartHour, dayEndHour],
  );
  const columns = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;
  const topOf = (minutes: number) => ((minutes - dayStartHour * 60) / 60) * HOUR_H;
  const firstDay = days[0] ?? today;

  // Open on the current hour rather than at midnight.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = Math.max(0, topOf(now.getHours() * 60) - 120);
  }, [firstDay, dayStartHour]);

  const nowLocal = toLocalDate(now);

  return (
    <div className="time-grid">
      <div className="time-head" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((date) => {
          const d = new Date(`${date}T00:00:00`);
          return (
            <button
              key={date}
              type="button"
              className={cn(
                "time-head-day",
                date === today && "today",
                date === selectedDate && "day-selected",
              )}
              onClick={() => onSelectDate(date)}
              onContextMenu={(e) => {
                onSelectDate(date);
                gestures.openDayMenu(e, date, null);
              }}
            >
              <span className="dow">{d.toLocaleDateString(localeTag(), { weekday: "short" })}</span>
              <span className="dom">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="allday-row" style={{ gridTemplateColumns: columns }}>
        <div className="allday-label">{t("allDayStrip")}</div>
        {days.map((date) => (
          <div
            key={date}
            className={cn(
              "allday-cell",
              gestures.dropTarget === `allday:${date}` && "drop-target",
            )}
            onContextMenu={(e) => {
              onSelectDate(date);
              gestures.openDayMenu(e, date, null);
            }}
            onDragOver={(e) => {
              if (!gestures.isDragging()) return;
              e.preventDefault();
              e.dataTransfer.dropEffect =
                e.ctrlKey || e.altKey || e.metaKey ? "copy" : "move";
              gestures.setDropTarget(`allday:${date}`);
            }}
            onDragLeave={() => {
              if (gestures.dropTarget === `allday:${date}`) gestures.setDropTarget(null);
            }}
            // Dropping in this strip is what makes a task all-day: the strip is
            // the one place on the grid that has no clock reading.
            onDrop={(e) => gestures.dropOn(e, date, null)}
          >
            {(instancesByDate.get(date) ?? [])
              .filter((i) => i.startsAt === null)
              .map((instance) => (
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
                  draggable={!instance.isRecurring}
                  dragging={gestures.dragging?.key === instance.key}
                  onDragStart={gestures.startDrag}
                  onDragEnd={gestures.endDrag}
                />
              ))}
          </div>
        ))}
      </div>

      <div ref={bodyRef} className="time-body scroll" style={{ gridTemplateColumns: columns }}>
        <div className="time-gutter" style={{ height: hours.length * HOUR_H }}>
          {hours.map((hour, index) => (
            <span key={hour} style={{ top: index * HOUR_H }}>
              {minutesToTime(hour * 60)}
            </span>
          ))}
        </div>

        {days.map((date) => (
          <DayColumn
            key={date}
            date={date}
            hours={hours}
            dayStartHour={dayStartHour}
            showNowLine={date === nowLocal}
            nowTop={topOf(now.getHours() * 60 + now.getMinutes())}
            instances={(instancesByDate.get(date) ?? []).filter((i) => i.startsAt !== null)}
            gestures={gestures}
            onSelectDate={onSelectDate}
            onOpen={onOpen}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>

      <ContextMenu state={gestures.menu} onClose={gestures.closeMenu} />
    </div>
  );
}

function DayColumn({
  date,
  hours,
  dayStartHour,
  showNowLine,
  nowTop,
  instances,
  gestures,
  onSelectDate,
  onOpen,
  onQuickAdd,
}: {
  date: LocalDate;
  hours: number[];
  dayStartHour: number;
  showNowLine: boolean;
  nowTop: number;
  instances: TaskInstance[];
  gestures: ReturnType<typeof useCalendarInteractions>;
  onSelectDate: (date: LocalDate) => void;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
}) {
  const categories = useCategoryIndex();
  const { t } = useI18n();
  const placed = useMemo(() => layout(instances, dayStartHour), [instances, dayStartHour]);

  /** The quarter-hour the pointer is over, so a drop keeps the time it aimed at. */
  const timeAt = (clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const raw = dayStartHour * 60 + ((clientY - rect.top) / HOUR_H) * 60;
    return minutesToTime(Math.min(23 * 60 + 45, Math.max(0, Math.round(raw / 15) * 15)));
  };

  return (
    <div
      className={cn("time-col", gestures.dropTarget === date && "drop-target")}
      style={{ height: hours.length * HOUR_H }}
      onClick={() => onSelectDate(date)}
      onDoubleClick={(e) => onQuickAdd(date, timeAt(e.clientY, e.currentTarget))}
      onContextMenu={(e) => {
        onSelectDate(date);
        gestures.openDayMenu(e, date, timeAt(e.clientY, e.currentTarget));
      }}
      onDragOver={(e) => {
        if (!gestures.isDragging()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect =
          e.ctrlKey || e.altKey || e.metaKey ? "copy" : "move";
        if (gestures.dropTarget !== date) gestures.setDropTarget(date);
      }}
      onDragLeave={() => {
        if (gestures.dropTarget === date) gestures.setDropTarget(null);
      }}
      onDrop={(e) => gestures.dropOn(e, date, timeAt(e.clientY, e.currentTarget))}
    >
      {hours.map((hour, index) => (
        <div key={hour}>
          <div className="time-line" style={{ top: index * HOUR_H }} />
          <div className="time-line half" style={{ top: index * HOUR_H + HOUR_H / 2 }} />
        </div>
      ))}

      {showNowLine ? <div className="now-line" style={{ top: nowTop }} /> : null}

      {placed.map(({ instance, top, height, left, width }) => {
        const category = instance.task.categoryId
          ? categories.get(instance.task.categoryId)
          : null;
        return (
          <button
            key={instance.key}
            type="button"
            className={cn(
              "event",
              instance.storedStatus === "COMPLETED" && "done",
              instance.status === "OVERDUE" && "overdue",
              gestures.dragging?.key === instance.key && "chip-dragging",
            )}
            style={{
              top,
              height,
              left: `calc(${left * 100}% + 3px)`,
              width: `calc(${width * 100}% - 6px)`,
              borderLeftColor: category?.color ?? "var(--accent)",
            }}
            draggable={!instance.isRecurring}
            onDragStart={(e) => {
              e.stopPropagation();
              gestures.startDrag(e, instance);
            }}
            onDragEnd={gestures.endDrag}
            onContextMenu={(e) => gestures.openTaskMenu(e, instance)}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(instance);
            }}
          >
            <span className="event-title truncate">{instance.task.title}</span>
            <span className="event-time">
              {instance.task.startTime}
              {instance.task.endTime ? ` - ${instance.task.endTime}` : ""}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        className="month-add"
        style={{ position: "absolute", top: 4, right: 4 }}
        title={t("addTaskOnDay")}
        onClick={(e) => {
          e.stopPropagation();
          onQuickAdd(date, "09:00");
        }}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

interface Placed {
  instance: TaskInstance;
  top: number;
  height: number;
  left: number;
  width: number;
}

function spanOf(instance: TaskInstance): number {
  const start = instance.task.startTime ?? "00:00";
  return instance.task.endTime
    ? Math.max(MIN_EVENT_MINUTES, durationMinutes(start, instance.task.endTime))
    : DEFAULT_EVENT_MINUTES;
}

/** Split overlapping tasks into side-by-side columns within their cluster. */
function layout(instances: TaskInstance[], dayStartHour: number): Placed[] {
  const sorted = [...instances].sort(
    (a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0),
  );
  const placed: Placed[] = [];
  let cluster: TaskInstance[] = [];
  let clusterEnd = -1;

  const flush = () => {
    cluster.forEach((instance, index) => {
      const start = minutesFromMidnight(instance.task.startTime ?? "00:00");
      placed.push({
        instance,
        top: ((start - dayStartHour * 60) / 60) * HOUR_H,
        height: (spanOf(instance) / 60) * HOUR_H,
        left: index / cluster.length,
        width: 1 / cluster.length,
      });
    });
    cluster = [];
  };

  for (const instance of sorted) {
    const start = minutesFromMidnight(instance.task.startTime ?? "00:00");
    if (cluster.length > 0 && start >= clusterEnd) flush();
    cluster.push(instance);
    clusterEnd = Math.max(clusterEnd, start + spanOf(instance));
  }
  flush();
  return placed;
}
