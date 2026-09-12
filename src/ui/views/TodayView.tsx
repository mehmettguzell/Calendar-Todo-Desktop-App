import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Plus,
  Sun,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import type { LocalDate, Task, TaskInstance } from "@/domain/types";
import { fireConfetti } from "@/lib/confetti";
import { useI18n } from "@/lib/i18n";
import {
  deadlineMarkersOf,
  splitDay,
  useFocusSessions,
  useGamificationStats,
  useInstancesInRange,
  useTodoGroups,
  useWeeklyStatsHook,
  type Filters,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { EmptyArt } from "@/ui/components/EmptyArt";
import { Empty } from "@/ui/components/primitives";
import { ResetOrderButton } from "@/ui/task/ResetOrderButton";
import { Composer, focusComposer } from "@/ui/task/Composer";
import { DeadlineMarkers } from "@/ui/task/DeadlineMarkers";
import { TaskList } from "@/ui/task/TaskList";
import { TodayHero } from "./today/TodayHero";

/**
 * Today: Command center with progress ring, inline quick add,
 * structured timed vs all-day tasks, overdue work, and weekly trends.
 */
export function TodayView({
  filters,
  selectedKey,
  onOpen,
  onPickDate,
}: {
  filters: Filters;
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  /** Opens a day in the calendar; the week strip is navigation too. */
  onPickDate?: (date: LocalDate) => void;
}) {
  const now = useNow();
  const today = toLocalDate(now);
  const groups = useTodoGroups(filters);
  const sessions = useFocusSessions();
  const rollOverTo = useStore((s) => s.rollOverTo);
  const { t } = useI18n();
  const { streaks } = useGamificationStats();
  const weeklyStats = useWeeklyStatsHook(7);

  const [rolled, setRolled] = useState(0);

  const overdue = groups.find((g) => g.id === "overdue")?.instances ?? [];
  // A recurring series is driven by its rule, so it is never rolled forward.
  const rollable = useMemo(
    () => overdue.filter((i) => !i.isRecurring && i.date !== null && i.date < today),
    [overdue, today],
  );
  /*
   * The day is always fetched whole, whatever the eye in the topbar says.
   *
   * The ring is a fraction — 3/5 — and it has no numerator if the finished
   * work is filtered out before it is counted. So the toggle decides one
   * thing only: whether the finished list is drawn underneath it.
   */
  const todayFilters = useMemo(
    () => ({ ...filters, showCompleted: true }),
    [filters],
  );
  const todays = useInstancesInRange(today, today, todayFilters);
  /*
   * The dates falling today, kept out of the lists below.
   *
   * `todays` holds them too — the calendar wants them — so everything that
   * counts or lists work filters them back out. Today's own filter forces
   * `showCompleted`, which for a checkpoint means a met one still shows: on
   * the day you hit it, that is the part of the day worth seeing.
   */
  const deadlineMarkers = useMemo(
    () => deadlineMarkersOf(todays, today),
    [todays, today],
  );

  const focusedToday = useMemo(
    () =>
      sessions
        .filter((s) => s.startedAt.slice(0, 10) === today)
        .reduce((total, s) => total + s.durationSec, 0),
    [sessions, today],
  );

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

  /*
   * The day, split the way it is drawn — and split by the same function
   * Odaklanma uses, so the two screens cannot put one day in two orders.
   */
  const day = useMemo(
    () => splitDay(todays.filter((i) => !overdueKeys.has(i.key))),
    [todays, overdueKeys],
  );
  const timedTasks = day.timed;
  const allDayTasks = day.allDay;
  const completedTodayTasks = day.completed;

  const done = completedTodayTasks.length;
  const openCount = timedTasks.length + allDayTasks.length;
  const dayCount = done + openCount;

  // Confetti trigger on 100% completion
  const prevDoneRef = useRef<number>(done);
  useEffect(() => {
    if (
      dayCount > 0 &&
      done === dayCount &&
      prevDoneRef.current < dayCount
    ) {
      fireConfetti({ particleCount: 100 });
    }
    prevDoneRef.current = done;
  }, [done, dayCount]);

  return (
    <div className="page">
      <TodayHero
        now={now}
        counts={{
          open: openCount,
          done,
          overdue: overdue.length,
          streak: streaks.currentStreak,
          focusedSec: focusedToday,
        }}
        weeklyStats={weeklyStats}
        onPickDate={onPickDate}
      />

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

      {/* The day's dates, before the day's work.
          A deadline is context for the list underneath rather than an item in
          it, so it sits above it and looks nothing like it. */}
      <DeadlineMarkers
        markers={deadlineMarkers}
        onOpen={onOpen}
        className="section"
      />

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
            icon={<EmptyArt kind="cleared" />}
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

      {filters.showCompleted ? (
        <CompletedToday
          instances={completedTodayTasks}
          selectedKey={selectedKey}
          onOpen={onOpen}
        />
      ) : null}

    </div>
  );
}

/** What the day already finished, folded away by default once it is long. */
function CompletedToday({
  instances,
  selectedKey,
  onOpen,
}: {
  instances: TaskInstance[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  if (instances.length === 0) return null;

  return (
    <section className="section">
      <div
        className="section-head"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <CheckCircle2 size={14} style={{ color: "var(--success)" }} />
        <h2>{t("todayCompletedHeading")}</h2>
        <span className="count">{instances.length}</span>
      </div>

      {open ? (
        <TaskList
          listId="today:completed"
          instances={instances}
          showDate={false}
          selectedKey={selectedKey}
          onOpen={onOpen}
        />
      ) : null}
    </section>
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
