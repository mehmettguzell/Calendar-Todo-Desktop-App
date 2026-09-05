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
import type { Task, TaskInstance } from "@/domain/types";
import { fireConfetti } from "@/lib/confetti";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  arrangeInstances,
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
import { ResetOrderButton } from "@/ui/task/ResetOrderButton";
import { Composer, focusComposer } from "@/ui/task/Composer";
import { TaskList } from "@/ui/task/TaskList";

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
  const rollOverTo = useStore((s) => s.rollOverTo);
  const { t } = useI18n();
  const { streaks } = useGamificationStats();
  const weeklyStats = useWeeklyStatsHook(7);

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
  const sorted = arrangeInstances(todays);
  const openCount = sorted.length - done;

  /*
   * Today's own tasks, minus the ones the Overdue section is already showing.
   *
   * A task due at 14:00 is overdue from 14:01, and it is still a task due
   * today — so without this it appears twice on one screen, once under each
   * heading. Two rows for one task is exactly the thing the whole app is built
   * not to do (spec section 3), and it is worse here than anywhere: ticking one
   * of them leaves the other sitting there looking unfinished.
   */
  const overdueKeys = useMemo(
    () => new Set(overdue.map((i) => i.key)),
    [overdue],
  );

  // Timed vs All-day vs Completed separation
  const timedTasks = useMemo(
    () =>
      sorted.filter(
        (t) =>
          t.storedStatus !== "COMPLETED" &&
          t.startsAt !== null &&
          !overdueKeys.has(t.key),
      ),
    [sorted, overdueKeys],
  );

  const allDayTasks = useMemo(
    () =>
      sorted.filter(
        (t) =>
          t.storedStatus !== "COMPLETED" &&
          t.startsAt === null &&
          !overdueKeys.has(t.key),
      ),
    [sorted, overdueKeys],
  );

  const completedTodayTasks = useMemo(
    () => sorted.filter((t) => t.storedStatus === "COMPLETED"),
    [sorted],
  );

  const hasWeekHistory = useMemo(
    () =>
      weeklyStats.some((day) => day.tasksDone > 0 || day.focusMinutes > 0),
    [weeklyStats],
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

  return (
    <div className="page">
      {/* Today Motivation & Progress Hero Header */}
      <div className={cn("today-hero-card section", !hasWeekHistory && "is-solo")}>
        <div className="today-hero-left">
          <ProgressRing
            completed={done}
            total={sorted.length}
            onCelebrate={() => fireConfetti({ particleCount: 100 })}
          />

          {/* Three lines, not five.
              The greeting used to arrive as a coloured pill, a second coloured
              pill for the streak, a sentence and a stat row — four decorated
              things above the first task, three of them saying some version of
              "you are doing fine". The greeting is now plain text (its colour
              still carries the mood), and the streak joined the stats, where
              every other number about today already lives. */}
          <div className="today-hero-text">
            <h2 className={cn("today-hero-headline", motivation.badgeType)}>
              {motivation.emoji}{" "}
              {t(motivation.titleKey as TranslationKey, motivation.params)}
            </h2>

            <p className="today-hero-subtitle">
              {t(motivation.subtitleKey as TranslationKey, {
                ...motivation.params,
                streak: motivation.streakDays
                  ? t("motivStreakSuffix", { n: motivation.streakDays })
                  : "",
              })}
            </p>

            <div className="today-hero-quickstats">
              <span className="today-hero-stat">
                <strong>{openCount}</strong> {t("todayOpen")}
              </span>
              <span className="today-hero-stat-dot">•</span>
              <span className="today-hero-stat">
                <strong>{done}</strong> {t("todayDone")}
              </span>
              {focusedToday > 0 && (
                <>
                  <span className="today-hero-stat-dot">•</span>
                  <span className="today-hero-stat">
                    <strong>{formatTracked(focusedToday)}</strong>{" "}
                    {t("todayFocusedStat")}
                  </span>
                </>
              )}
              {overdue.length > 0 && (
                <>
                  <span className="today-hero-stat-dot">•</span>
                  <span className="today-hero-stat danger">
                    <strong>{overdue.length}</strong> {t("todayOverdueStat")}
                  </span>
                </>
              )}
              {streaks.currentStreak > 0 && (
                <>
                  <span className="today-hero-stat-dot">•</span>
                  <span
                    className="today-hero-stat streak"
                    title={t("todayStreakBadge", { n: streaks.currentStreak })}
                  >
                    <Flame size={11} aria-hidden />
                    <strong>{streaks.currentStreak}</strong>{" "}
                    {t("todayStreakUnit")}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* A chart of seven empty days is the first thing a new account would
            see, and it says nothing except that there is nothing. It arrives
            with the first finished task and stays from then on. */}
        {hasWeekHistory ? (
          <div className="today-hero-right">
            <WeeklyBarChart stats={weeklyStats} />
          </div>
        ) : null}
      </div>

      {/* The same box as every other "add a task" in the app. The high-priority
          toggle that used to sit beside it is not gone — "!yüksek" in the line
          says it, and so does the priority field under Detaylar. */}
      <div className="section">
        <Composer defaultDate={today} placeholder={t("todayFastAdd")} />
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
              <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                {rolled} {t("rollOverDone")}
              </span>
            ) : null
          }
        >
          <TaskList
            listId="today:overdue"
            instances={overdue}
            selectedKey={selectedKey}
            onOpen={onOpen}
          />
        </Section>
      ) : null}

      {/* Timed Tasks Section */}
      {timedTasks.length > 0 ? (
        <Section
          title={t("todayTimed")}
          count={timedTasks.length}
          icon={<Clock size={14} />}
          tasks={timedTasks.map((instance) => instance.task)}
        >
          <TaskList
            listId="today:timed"
            instances={timedTasks}
            showDate={false}
            selectedKey={selectedKey}
            onOpen={onOpen}
          />
        </Section>
      ) : null}

      {/* All-Day / Flexible Tasks Section */}
      <Section
        title={t("todayAllDay")}
        count={allDayTasks.length}
        icon={<Sun size={14} />}
        tasks={allDayTasks.map((instance) => instance.task)}
      >
        {allDayTasks.length === 0 && timedTasks.length === 0 ? (
          <Empty
            icon={<CalendarCheck size={28} />}
            title={t("todayEmptyTitle")}
            hint={t("todayEmptyHint")}
            action={
              <button
                type="button"
                className="btn primary"
                onClick={() => focusComposer()}
              >
                <Plus size={14} /> {t("emptyAddFirstTask")}
              </button>
            }
          />
        ) : (
          <TaskList
            listId="today:allDay"
            instances={allDayTasks}
            showDate={false}
            selectedKey={selectedKey}
            onOpen={onOpen}
          />
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
            <h2>{t("todayCompletedHeading")}</h2>
            <span className="count">{completedTodayTasks.length}</span>
          </div>

          {showCompletedSection && (
            <TaskList
              listId="today:completed"
              instances={completedTodayTasks}
              showDate={false}
              selectedKey={selectedKey}
              onOpen={onOpen}
            />
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
  tasks,
  children,
}: {
  title: string;
  count: number;
  alert?: boolean;
  icon?: React.ReactNode;
  /** Optional control on the right of the heading, e.g. "roll these over". */
  action?: React.ReactNode;
  /** The rows this heading counts — lets it offer a way out of a manual order. */
  tasks?: Task[];
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className={alert ? "section-head alert" : "section-head"}>
        {icon}
        <h2>{title}</h2>
        <span className="count">{count}</span>
        {tasks ? <ResetOrderButton tasks={tasks} /> : null}
        {action ? (
          <>
            <span className="grow" />
            {action}
          </>
        ) : null}
      </div>
      {/* The children bring their own list container: a reorderable list has to
          own the element that drops land on. */}
      {children}
    </section>
  );
}
