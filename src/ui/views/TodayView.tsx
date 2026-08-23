import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Flame,
  Plus,
  Sun,
} from "lucide-react";
import { formatTracked, toLocalDate } from "@/domain/datetime";
import { getMotivationalMessage } from "@/domain/gamification";
import type { Priority, TaskInstance } from "@/domain/types";
import { fireConfetti } from "@/lib/confetti";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  compareInstances,
  useFocusSessions,
  useGamificationStats,
  useInstancesInRange,
  useTodoGroups,
  useWeeklyStatsHook,
  type Filters,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { Empty } from "@/ui/components/primitives";
import { ProgressRing } from "@/ui/components/ProgressRing";
import { WeeklyBarChart } from "@/ui/components/WeeklyBarChart";
import { TaskRow } from "@/ui/task/TaskRow";

/**
 * Today: Command center with progress ring, inline quick add,
 * structured timed vs all-day tasks, overdue work, and weekly trends.
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
  const sessions = useFocusSessions();
  const createTask = useStore((s) => s.createTask);
  const rollOverTo = useStore((s) => s.rollOverTo);
  const { t } = useI18n();
  const { streaks } = useGamificationStats();
  const weeklyStats = useWeeklyStatsHook(7);

  const [quickTitle, setQuickTitle] = useState("");
  const [quickPriority, setQuickPriority] = useState<Priority>("NONE");
  const [showCompletedSection, setShowCompletedSection] = useState(true);
  const [rolled, setRolled] = useState(0);

  const overdue = groups.find((g) => g.id === "overdue")?.instances ?? [];
  // A recurring series is driven by its rule, so it is never rolled forward.
  const rollable = useMemo(
    () => overdue.filter((i) => !i.isRecurring && i.date !== null && i.date < today),
    [overdue, today],
  );
  // Today always shows what was finished today, whatever the global filter says.
  const todayFilters = useMemo(
    () => ({ ...filters, showCompleted: true }),
    [filters],
  );
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

  // Timed vs All-day vs Completed separation
  const timedTasks = useMemo(
    () =>
      sorted.filter(
        (t) => t.storedStatus !== "COMPLETED" && t.startsAt !== null,
      ),
    [sorted],
  );

  const allDayTasks = useMemo(
    () =>
      sorted.filter(
        (t) => t.storedStatus !== "COMPLETED" && t.startsAt === null,
      ),
    [sorted],
  );

  const completedTodayTasks = useMemo(
    () => sorted.filter((t) => t.storedStatus === "COMPLETED"),
    [sorted],
  );

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

  const handleQuickAddToday = () => {
    const trimmed = quickTitle.trim();
    if (!trimmed) return;
    createTask({
      title: trimmed,
      dueDate: today,
      allDay: true,
      priority: quickPriority,
    });
    setQuickTitle("");
    setQuickPriority("NONE");
  };

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
                <span
                  className="today-streak-badge"
                  title={`${streaks.currentStreak} günlük seri`}
                >
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

      {/* Inline Fast Add for Today */}
      <div className="today-fast-add-bar section">
        <input
          className="input grow today-fast-input"
          placeholder="+ Bugün için hızlı görev ekle… (Enter'a bas)"
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickAddToday();
          }}
        />
        <div className="row" style={{ gap: 4 }}>
          <button
            type="button"
            className={cn(
              "btn sm ghost",
              quickPriority === "HIGH" && "active prio-high-active",
            )}
            title="Yüksek Öncelik"
            onClick={() =>
              setQuickPriority(quickPriority === "HIGH" ? "NONE" : "HIGH")
            }
          >
            🔥 Yüksek
          </button>
          <button
            type="button"
            className="btn sm primary"
            disabled={!quickTitle.trim()}
            onClick={handleQuickAddToday}
          >
            <Plus size={13} /> Ekle
          </button>
        </div>
      </div>

      {/* Overdue Section */}
      {overdue.length > 0 ? (
        <Section
          title={t("todayOverdue")}
          count={overdue.length}
          alert
          icon={<CircleAlert size={14} />}
          action={
            rollable.length > 0 ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  const moved = rollOverTo(
                    rollable.map((i) => i.task.id),
                    today,
                  );
                  if (moved > 0) setRolled(moved);
                }}
                title={t("rollOverHint")}
              >
                <CalendarCheck size={13} /> {t("rollOver")}
              </button>
            ) : rolled > 0 ? (
              <span className="faint" style={{ fontSize: 12 }}>
                {rolled} {t("rollOverDone")}
              </span>
            ) : null
          }
        >
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

      {/* Timed Tasks Section */}
      {timedTasks.length > 0 ? (
        <Section
          title={t("todayTimed")}
          count={timedTasks.length}
          icon={<Clock size={14} />}
        >
          {timedTasks.map((instance) => (
            <TaskRow
              key={instance.key}
              instance={instance}
              showDate={false}
              selected={instance.key === selectedKey}
              onOpen={onOpen}
            />
          ))}
        </Section>
      ) : null}

      {/* All-Day / Flexible Tasks Section */}
      <Section
        title={t("todayAllDay")}
        count={allDayTasks.length}
        icon={<Sun size={14} />}
      >
        {allDayTasks.length === 0 && timedTasks.length === 0 ? (
          <Empty
            icon={<CalendarCheck size={28} />}
            title="Bugün için açık görev yok"
            hint="Yukarıdaki çubuktan hızlıca görev ekleyebilir veya günün keyfini çıkarabilirsiniz."
          />
        ) : (
          allDayTasks.map((instance) => (
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

      {/* Completed Today Section */}
      {completedTodayTasks.length > 0 ? (
        <section className="section">
          <div
            className="section-head"
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setShowCompletedSection((v) => !v)}
          >
            {showCompletedSection ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
            <CheckCircle2 size={14} style={{ color: "var(--success)" }} />
            <h2>Bugün Tamamlananlar</h2>
            <span className="count">{completedTodayTasks.length}</span>
          </div>

          {showCompletedSection && (
            <div className="task-list">
              {completedTodayTasks.map((instance) => (
                <TaskRow
                  key={instance.key}
                  instance={instance}
                  showDate={false}
                  selected={instance.key === selectedKey}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  alert,
  icon,
  action,
  children,
}: {
  title: string;
  count: number;
  alert?: boolean;
  icon?: React.ReactNode;
  /** Optional control on the right of the heading, e.g. "roll these over". */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className={alert ? "section-head alert" : "section-head"}>
        {icon}
        <h2>{title}</h2>
        <span className="count">{count}</span>
        {action ? (
          <>
            <span className="grow" />
            {action}
          </>
        ) : null}
      </div>
      <div className="task-list">{children}</div>
    </section>
  );
}
