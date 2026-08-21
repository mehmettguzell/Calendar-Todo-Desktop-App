import { useMemo } from "react";
import { CalendarCheck, CircleAlert, Sun } from "lucide-react";
import { addDaysLocal, formatTracked, toLocalDate } from "@/domain/datetime";
import type { TaskInstance } from "@/domain/types";
import {
  compareInstances,
  useFocusSessions,
  useInstancesInRange,
  useTodoGroups,
  type Filters,
} from "@/state/selectors";
import { useNow } from "@/state/store";
import { Empty } from "@/ui/components/primitives";
import { TaskRow } from "@/ui/task/TaskRow";

/**
 * Today: overdue work first, then today's schedule, then what is coming next.
 * Same rows as the calendar and the todo list, filtered to what matters now.
 */
export function TodayView({
  filters,
  selectedKey,
  onOpen,
}: {
  filters: Filters;
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const now = useNow();
  const today = toLocalDate(now);
  const groups = useTodoGroups(filters);
  const upcoming = useInstancesInRange(addDaysLocal(today, 1), addDaysLocal(today, 3), filters);
  const sessions = useFocusSessions();

  const overdue = groups.find((g) => g.id === "overdue")?.instances ?? [];
  // Today always shows what was finished today, whatever the global filter says.
  const todayFilters = useMemo(() => ({ ...filters, showCompleted: true }), [filters]);
  const todays = useInstancesInRange(today, today, todayFilters);

  const focusedToday = useMemo(
    () =>
      sessions
        .filter((s) => s.startedAt.slice(0, 10) === today)
        .reduce((total, s) => total + s.durationSec, 0),
    [sessions, today],
  );

  const done = todays.filter((i) => i.storedStatus === "COMPLETED").length;
  const sorted = [...todays].sort(compareInstances);

  return (
    <div className="page">
      <div className="stat-grid section">
        <div className="stat">
          <div className="value">{sorted.length - done}</div>
          <div className="label">Open today</div>
        </div>
        <div className="stat">
          <div className="value">{done}</div>
          <div className="label">Completed today</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: overdue.length ? "var(--danger)" : undefined }}>
            {overdue.length}
          </div>
          <div className="label">Overdue</div>
        </div>
        <div className="stat">
          <div className="value">{formatTracked(focusedToday)}</div>
          <div className="label">Focused today</div>
        </div>
      </div>

      {overdue.length > 0 ? (
        <Section title="Overdue" count={overdue.length} alert icon={<CircleAlert size={14} />}>
          {overdue.map((instance) => (
            <TaskRow
              key={instance.key}
              instance={instance}
              selected={instance.key === selectedKey}
              onOpen={onOpen}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Today" count={sorted.length} icon={<Sun size={14} />}>
        {sorted.length === 0 ? (
          <Empty
            icon={<CalendarCheck size={28} />}
            title="Nothing scheduled today"
            hint="Add a task or enjoy the quiet."
          />
        ) : (
          sorted.map((instance) => (
            <TaskRow
              key={instance.key}
              instance={instance}
              showDate={false}
              selected={instance.key === selectedKey}
              onOpen={onOpen}
            />
          ))
        )}
      </Section>

      {upcoming.length > 0 ? (
        <Section title="Next few days" count={upcoming.length}>
          {upcoming.map((instance) => (
            <TaskRow
              key={instance.key}
              instance={instance}
              selected={instance.key === selectedKey}
              onOpen={onOpen}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  alert,
  icon,
  children,
}: {
  title: string;
  count: number;
  alert?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className={alert ? "section-head alert" : "section-head"}>
        {icon}
        <h2>{title}</h2>
        <span className="count">{count}</span>
      </div>
      <div className="task-list">{children}</div>
    </section>
  );
}
