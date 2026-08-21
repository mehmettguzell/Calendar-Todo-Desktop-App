import { useEffect, useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import { durationMinutes, minutesFromMidnight, minutesToTime, toLocalDate } from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useCategoryIndex } from "@/state/selectors";
import { TaskChip } from "./TaskChip";

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
  onOpen,
  onQuickAdd,
}: {
  days: LocalDate[];
  today: LocalDate;
  now: Date;
  dayStartHour: number;
  dayEndHour: number;
  instancesByDate: Map<LocalDate, TaskInstance[]>;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
}) {
  const categories = useCategoryIndex();
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
            <div key={date} className={cn("time-head-day", date === today && "today")}>
              <span className="dow">{d.toLocaleDateString([], { weekday: "short" })}</span>
              <span className="dom">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="allday-row" style={{ gridTemplateColumns: columns }}>
        <div className="allday-label">All-day</div>
        {days.map((date) => (
          <div key={date} className="allday-cell">
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
            onOpen={onOpen}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>
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
  onOpen,
  onQuickAdd,
}: {
  date: LocalDate;
  hours: number[];
  dayStartHour: number;
  showNowLine: boolean;
  nowTop: number;
  instances: TaskInstance[];
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
}) {
  const categories = useCategoryIndex();
  const placed = useMemo(() => layout(instances, dayStartHour), [instances, dayStartHour]);

  return (
    <div
      className="time-col"
      style={{ height: hours.length * HOUR_H }}
      onDoubleClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        const raw = dayStartHour * 60 + (offset / HOUR_H) * 60;
        onQuickAdd(date, minutesToTime(Math.round(raw / 15) * 15));
      }}
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
            )}
            style={{
              top,
              height,
              left: `calc(${left * 100}% + 3px)`,
              width: `calc(${width * 100}% - 6px)`,
              borderLeftColor: category?.color ?? "var(--accent)",
            }}
            onClick={() => onOpen(instance)}
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
        title="Add task on this day"
        onClick={() => onQuickAdd(date, "09:00")}
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
