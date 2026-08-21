import { useEffect, useMemo, useRef } from "react";
import { CalendarCheck, CircleAlert, Flame, Sun } from "lucide-react";
import { addDaysLocal, formatTracked, toLocalDate } from "@/domain/datetime";
import { getMotivationalMessage } from "@/domain/gamification";
import type { TaskInstance } from "@/domain/types";
import { fireConfetti } from "@/lib/confetti";
import {
  compareInstances,
  useFocusSessions,
  useGamificationStats,
  useInstancesInRange,
  useTodoGroups,
  useWeeklyStatsHook,
  type Filters,
} from "@/state/selectors";
import { useNow } from "@/state/store";
import { Empty } from "@/ui/components/primitives";
import { ProgressRing } from "@/ui/components/ProgressRing";
import { WeeklyBarChart } from "@/ui/components/WeeklyBarChart";
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
  const { streaks } = useGamificationStats();
  const weeklyStats = useWeeklyStatsHook(7);

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
  const openCount = sorted.length - done;

  // Dynamic motivational message
  const motivation = useMemo(
    () =>
      getMotivationalMessage({
        openCount,
        doneCount: done,
        overdueCount: overdue.length,
        streak: streaks.currentStreak,
      }),
    [openCount, done, overdue.length, streaks.currentStreak],
  );

  // Confetti trigger on 100% completion
  const prevDoneRef = useRef<number>(done);
  useEffect(() => {
    if (
      sorted.length > 0 &&
      done === sorted.length &&
      prevDoneRef.current < sorted.length
    ) {
      fireConfetti({ particleCount: 100 });
    }
    prevDoneRef.current = done;
  }, [done, sorted.length]);

  return (
    <div className="page">
      {/* Today Motivation & Progress Hero Header */}
      <div className="today-hero-card section">
        <div className="today-hero-left">
          <ProgressRing
            completed={done}
            total={sorted.length}
            onCelebrate={() => fireConfetti({ particleCount: 100 })}
          />

          <div className="today-hero-text">
            <div className="today-motivation-badge-row">
              <span className={`today-badge ${motivation.badgeType}`}>
                {motivation.emoji} {motivation.title}
              </span>
              {streaks.currentStreak > 0 && (
                <span className="today-streak-badge" title={`${streaks.currentStreak} günlük seri`}>
                  <Flame size={12} /> {streaks.currentStreak} gün seri
                </span>
              )}
            </div>

            <p className="today-hero-subtitle">{motivation.subtitle}</p>

            <div className="today-hero-quickstats">
              <span className="today-hero-stat">
                <strong>{openCount}</strong> açık
              </span>
              <span className="today-hero-stat-dot">•</span>
              <span className="today-hero-stat">
                <strong>{done}</strong> tamamlandı
              </span>
              {focusedToday > 0 && (
                <>
                  <span className="today-hero-stat-dot">•</span>
                  <span className="today-hero-stat">
                    <strong>{formatTracked(focusedToday)}</strong> odaklanma
                  </span>
                </>
              )}
              {overdue.length > 0 && (
                <>
                  <span className="today-hero-stat-dot">•</span>
                  <span className="today-hero-stat danger">
                    <strong>{overdue.length}</strong> gecikmiş
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="today-hero-right">
          <WeeklyBarChart stats={weeklyStats} />
        </div>
      </div>

      {/* Overdue Section */}
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

      {/* Today's Tasks Section */}
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

      {/* Upcoming Section */}
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
