import { useMemo } from "react";
import { addDaysLocal, localeTag, toLocalDate } from "@/domain/datetime";
import { namedDeadlineKey, occurrenceId } from "@/domain/ids";
import { arrangePinned, pinOf } from "@/domain/manualOrder";
import {
  enclosingPlan,
  instancesInRange,
  representativeInstance,
  toInstance,
} from "@/domain/task";
import { sortDeadlines, type Deadline } from "@/domain/deadline";
import type {
  Category,
  FocusSession,
  HistoryEntry,
  LocalDate,
  Occurrence,
  Priority,
  Reminder,
  Task,
  TaskInstance,
} from "@/domain/types";
import {
  calculateLevel,
  calculateTotalXp,
  computeActivityMap,
  computeStreaks,
  computeWeeklyStats,
  type DayActivity,
  type LevelInfo,
  type StreakInfo,
  type WeeklyDayStat,
} from "@/domain/gamification";
import { useNow, useStore } from "./store";

export interface Filters {
  categoryIds: string[];
  priorities: Priority[];
  tags: string[];
  query: string;
  showCompleted: boolean;
}

export const EMPTY_FILTERS: Filters = {
  categoryIds: [],
  priorities: [],
  tags: [],
  query: "",
  showCompleted: false,
};

/** Live (non-trashed) tasks: the base every projection starts from. */
export function useLiveTasks(): Task[] {
  const tasks = useStore((s) => s.db.tasks);
  return useMemo(() => tasks.filter((t) => t.deletedAt === null), [tasks]);
}

export function useTrashedTasks(): Task[] {
  const tasks = useStore((s) => s.db.tasks);
  return useMemo(() => tasks.filter((t) => t.deletedAt !== null), [tasks]);
}

export function useOccurrenceIndex(): Map<string, Occurrence> {
  const occurrences = useStore((s) => s.db.occurrences);
  return useMemo(
    () => new Map(occurrences.map((o) => [o.id, o])),
    [occurrences],
  );
}

export function useCategories(): Category[] {
  const categories = useStore((s) => s.db.categories);
  return useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );
}

export function useCategoryIndex(): Map<string, Category> {
  const categories = useStore((s) => s.db.categories);
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}

export function useAllTags(): string[] {
  const tasks = useLiveTasks();
  return useMemo(() => {
    const set = new Set<string>();
    for (const task of tasks) for (const tag of task.tags) set.add(tag);
    return [...set].sort();
  }, [tasks]);
}

/**
 * Every task instance falling inside a date range.
 *
 * This is the only thing the calendar reads: month, week and day are three
 * layouts over one query, so they cannot disagree with the todo list.
 */
export function useInstancesInRange(
  from: LocalDate,
  to: LocalDate,
  filters: Filters = EMPTY_FILTERS,
): TaskInstance[] {
  const tasks = useLiveTasks();
  const occurrences = useOccurrenceIndex();
  const deadlineIndex = useDeadlineIndex();
  const now = useNow();

  return useMemo(() => {
    const out: TaskInstance[] = [];
    const parentCache = new Map<string, Task>();
    for (const t of tasks) parentCache.set(t.id, t);

    for (const task of tasks) {
      if (task.parentId) {
        // Regular subtasks are hidden from the calendar, they only render
        // inside their parent. A plan's steps are allowed to show up on it —
        // including a step's own steps, which are as much part of the plan as
        // the ones directly beneath it.
        if (!enclosingPlan(task, parentCache)) continue;
      }

      if (!matchesFilters(task, filters)) continue;
      for (const instance of instancesInRange(
        task,
        from,
        to,
        occurrences,
        now,
      )) {
        if (!filters.showCompleted && instance.status === "COMPLETED") continue;
        out.push(instance);
      }

      /*
       * A task's checkpoints are drawn like its own deadline: once, on the day
       * they fall, under their own name. They are markers rather than work, so
       * they never paint the days leading up to them and never become a second
       * row for the task on a day it already occupies.
       */
      for (const deadline of deadlineIndex.get(task.id) ?? []) {
        if (deadline.date < from || deadline.date > to) continue;
        if (!filters.showCompleted && deadline.completedAt !== null) continue;
        out.push({
          ...toInstance(task, deadline.date, null, now),
          key: namedDeadlineKey(task.id, deadline.id),
          isDeadline: true,
          deadlineId: deadline.id,
          deadlineLabel: deadline.label,
          deadlineMet: deadline.completedAt !== null,
        });
      }
    }
    return out.sort(compareInstances);
  }, [tasks, occurrences, deadlineIndex, from, to, filters, now]);
}

export function groupByDate(
  instances: TaskInstance[],
): Map<LocalDate, TaskInstance[]> {
  const map = new Map<LocalDate, TaskInstance[]>();
  for (const instance of instances) {
    if (!instance.date) continue;
    const bucket = map.get(instance.date);
    if (bucket) bucket.push(instance);
    else map.set(instance.date, [instance]);
  }
  for (const bucket of map.values()) bucket.sort(compareInstances);
  return map;
}

/** All-day items sort above timed items; timed items sort by start. */
export function compareInstances(a: TaskInstance, b: TaskInstance): number {
  const aTimed = a.startsAt !== null;
  const bTimed = b.startsAt !== null;
  if (aTimed !== bTimed) return aTimed ? 1 : -1;
  if (a.startsAt && b.startsAt) {
    const diff = a.startsAt.getTime() - b.startsAt.getTime();
    if (diff !== 0) return diff;
  }
  const priority =
    priorityRank(b.task.priority) - priorityRank(a.task.priority);
  if (priority !== 0) return priority;
  return (
    a.task.order - b.task.order || a.task.title.localeCompare(b.task.title)
  );
}

/**
 * Plan steps as they read on screen: what the user dragged, finished last.
 *
 * A plan is a list you work down, so a ticked step has stopped being part of
 * it — it is evidence that the plan is moving. Left where it was, it pushes
 * the next thing to do further down the card every time something gets done,
 * which is the opposite of what finishing something should do.
 *
 * Order inside each half is untouched, and nothing is written: a step that is
 * reopened climbs straight back to the place it was dragged to, because that
 * place was never given away.
 */
export function compareSteps(a: Task, b: Task): number {
  return (
    Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED") ||
    a.order - b.order
  );
}

export function arrangeSteps(steps: Task[]): Task[] {
  return [...steps].sort(compareSteps);
}

/**
 * A list exactly as it reads on screen: the automatic sort, then manual pins.
 *
 * Every list-shaped view goes through here, so a task dragged in Today sits
 * where it was dropped in Todo too — one task, one arrangement.
 */
export function arrangeInstances(instances: TaskInstance[]): TaskInstance[] {
  return arrangePinned([...instances].sort(compareInstances), (i) =>
    pinOf(i.task),
  );
}

export function priorityRank(priority: Priority): number {
  return { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 }[priority];
}

export function matchesFilters(task: Task, filters: Filters): boolean {
  if (
    filters.categoryIds.length > 0 &&
    !filters.categoryIds.includes(task.categoryId ?? "")
  ) {
    return false;
  }
  if (
    filters.priorities.length > 0 &&
    !filters.priorities.includes(task.priority)
  )
    return false;
  if (
    filters.tags.length > 0 &&
    !filters.tags.some((tag) => task.tags.includes(tag))
  )
    return false;
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const haystack =
      `${task.title} ${task.description} ${task.tags.join(" ")}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export interface TodoGroup {
  id: string;
  /** Dictionary key — the view spells the heading, this file only names it. */
  labelKey: string;
  instances: TaskInstance[];
}

const TODO_GROUPS: [string, string][] = [
  ["overdue", "groupOverdue"],
  ["today", "groupToday"],
  ["tomorrow", "groupTomorrow"],
  ["week", "groupWeek"],
  ["later", "groupLater"],
  ["someday", "groupSomeday"],
  ["completed", "groupCompleted"],
];

/**
 * The Todo projection: the same rows the calendar draws, bucketed by urgency
 * instead of laid out on a grid.
 */
export function useTodoGroups(filters: Filters): TodoGroup[] {
  const tasks = useLiveTasks();
  const occurrences = useOccurrenceIndex();
  const now = useNow();

  return useMemo(() => {
    const today = toLocalDate(now);
    const tomorrow = addDaysLocal(today, 1);
    const weekEnd = addDaysLocal(today, 7);
    const buckets = new Map<string, TaskInstance[]>(
      TODO_GROUPS.map(([id]) => [id, []]),
    );
    const push = (id: string, instance: TaskInstance) =>
      buckets.get(id)?.push(instance);

    // One row per task *per day*: the same run must never be listed twice
    // because it is both the representative and today's occurrence.
    const seen = new Set<string>();
    const place = (instance: TaskInstance) => {
      const key = `${instance.task.id}:${instance.date ?? "someday"}`;
      if (seen.has(key)) return;
      seen.add(key);

      if (instance.status === "COMPLETED") {
        if (filters.showCompleted) push("completed", instance);
      } else if (!instance.date) {
        push("someday", instance);
      } else if (instance.status === "OVERDUE") {
        push("overdue", instance);
      } else if (instance.date === today) {
        push("today", instance);
      } else if (instance.date === tomorrow) {
        push("tomorrow", instance);
      } else if (instance.date <= weekEnd) {
        push("week", instance);
      } else {
        push("later", instance);
      }
    };

    const parentCache = new Map<string, Task>();
    for (const t of tasks) parentCache.set(t.id, t);

    for (const task of tasks) {
      if (task.tags.includes("note")) continue; // notes render in their own view

      if (task.parentId) {
        // Only scheduled steps of a plan reach the todo groups, at whatever
        // depth they sit: an ordinary subtask belongs inside its task.
        if (!task.dueDate || !enclosingPlan(task, parentCache)) {
          continue;
        }
      } else if (task.tags.includes("plan")) {
        // Only show plans in todo groups if they have a scheduled due date
        if (!task.dueDate) {
          continue;
        }
      }

      if (!matchesFilters(task, filters)) continue;

      // The oldest run still open is what a task shows when it shows once.
      place(representativeInstance(task, occurrences, now));

      // …but a task can be put on extra days of its own week, and those days
      // are the entire point of that feature: if the calendar draws this task
      // on Wednesday, "Tomorrow" has to list it on Wednesday too. Only the two
      // day-level buckets are filled per occurrence — Week and Later stay one
      // row per task, or a daily habit would fill them with itself.
      for (const instance of instancesInRange(task, today, tomorrow, occurrences, now)) {
        place(instance);
      }
    }

    return TODO_GROUPS.map(([id, labelKey]) => ({
      id,
      labelKey,
      instances: arrangeInstances(buckets.get(id) ?? []),
    })).filter((group) => group.instances.length > 0);
  }, [tasks, occurrences, filters, now]);
}

/**
 * Answers every row needs about itself, built once for the whole list.
 *
 * `useMemo` memoises per component, so a hook that scanned the task list to
 * answer "what are *this* row's subtasks?" did that scan once per rendered row
 * — quadratic in the size of the account, and re-run on every render including
 * the once-a-minute clock tick. Measured at 400 rows over 1200 tasks it cost
 * ~14ms a pass; indexed it is under 1ms.
 *
 * The cache is keyed on the array itself, so it is built once per store write
 * no matter how many components ask, and is collected with the array it
 * describes. The hooks below keep their old signatures: nothing at a call site
 * had to change.
 */
const EMPTY_TASKS: readonly Task[] = Object.freeze([]);
const EMPTY_SESSIONS: readonly FocusSession[] = Object.freeze([]);

const subtaskIndexes = new WeakMap<Task[], Map<string, Task[]>>();
const trackedIndexes = new WeakMap<FocusSession[], Map<string, number>>();
const sessionIndexes = new WeakMap<FocusSession[], Map<string, FocusSession[]>>();

function subtaskIndex(tasks: Task[]): Map<string, Task[]> {
  const cached = subtaskIndexes.get(tasks);
  if (cached) return cached;

  const index = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentId === null || task.deletedAt !== null) continue;
    const bucket = index.get(task.parentId);
    if (bucket) bucket.push(task);
    else index.set(task.parentId, [task]);
  }
  for (const bucket of index.values()) bucket.sort(compareSteps);
  subtaskIndexes.set(tasks, index);
  return index;
}

function sessionIndex(sessions: FocusSession[]): Map<string, FocusSession[]> {
  const cached = sessionIndexes.get(sessions);
  if (cached) return cached;

  const index = new Map<string, FocusSession[]>();
  for (const session of sessions) {
    const bucket = index.get(session.taskId);
    if (bucket) bucket.push(session);
    else index.set(session.taskId, [session]);
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  sessionIndexes.set(sessions, index);
  return index;
}

function trackedIndex(sessions: FocusSession[]): Map<string, number> {
  const cached = trackedIndexes.get(sessions);
  if (cached) return cached;

  const index = new Map<string, number>();
  for (const session of sessions) {
    index.set(session.taskId, (index.get(session.taskId) ?? 0) + session.durationSec);
  }
  trackedIndexes.set(sessions, index);
  return index;
}

const reminderIndexes = new WeakMap<Reminder[], Set<string>>();

/** The tasks carrying a live reminder — one pass, not one scan per row. */
function reminderIndex(reminders: Reminder[]): Set<string> {
  const cached = reminderIndexes.get(reminders);
  if (cached) return cached;

  const index = new Set<string>();
  for (const reminder of reminders) {
    if (reminder.status !== "DISMISSED") index.add(reminder.taskId);
  }
  reminderIndexes.set(reminders, index);
  return index;
}

export function useHasReminder(taskId: string): boolean {
  const reminders = useStore((s) => s.db.reminders);
  return reminderIndex(reminders).has(taskId);
}

/**
 * The checkpoints of one task, in date order.
 *
 * Soft-deleted rows are filtered here rather than at every call site: a removed
 * deadline is kept so an undo can put it back, and nothing else should ever
 * have to know that.
 */
export function useDeadlines(taskId: string | null): Deadline[] {
  const deadlines = useStore((s) => s.db.deadlines);
  return useMemo(() => {
    if (!taskId) return EMPTY_DEADLINES;
    const own = deadlines.filter(
      (d) => d.taskId === taskId && d.deletedAt === null,
    );
    return own.length > 0 ? sortDeadlines(own) : EMPTY_DEADLINES;
  }, [deadlines, taskId]);
}

const EMPTY_DEADLINES: Deadline[] = [];

/** Every live deadline, bucketed by the task it belongs to. */
export function useDeadlineIndex(): Map<string, Deadline[]> {
  const deadlines = useStore((s) => s.db.deadlines);
  return useMemo(() => {
    const index = new Map<string, Deadline[]>();
    for (const d of deadlines) {
      if (d.deletedAt !== null) continue;
      const bucket = index.get(d.taskId);
      if (bucket) bucket.push(d);
      else index.set(d.taskId, [d]);
    }
    return index;
  }, [deadlines]);
}

export function useSubtasks(parentId: string): Task[] {
  const tasks = useStore((s) => s.db.tasks);
  return subtaskIndex(tasks).get(parentId) ?? (EMPTY_TASKS as Task[]);
}

export function useTaskHistory(taskId: string): HistoryEntry[] {
  const history = useStore((s) => s.db.history);
  return useMemo(
    () =>
      history
        .filter((h) => h.taskId === taskId)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [history, taskId],
  );
}

export function useFocusSessions(taskId?: string): FocusSession[] {
  const sessions = useStore((s) => s.db.focusSessions);
  const all = useMemo(
    () => [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [sessions],
  );
  if (!taskId) return all;
  return sessionIndex(sessions).get(taskId) ?? (EMPTY_SESSIONS as FocusSession[]);
}

export function useTrackedSeconds(taskId: string): number {
  const sessions = useStore((s) => s.db.focusSessions);
  return trackedIndex(sessions).get(taskId) ?? 0;
}

export function useTaskById(taskId: string | null): Task | null {
  const tasks = useStore((s) => s.db.tasks);
  return useMemo(
    () => tasks.find((t) => t.id === taskId) ?? null,
    [tasks, taskId],
  );
}

export function occurrenceFor(
  occurrences: Map<string, Occurrence>,
  taskId: string,
  date: LocalDate | null,
): Occurrence | null {
  return date ? (occurrences.get(occurrenceId(taskId, date)) ?? null) : null;
}

/**
 * Computes an activity map for all recorded tasks, occurrences, focus sessions, and history.
 */
export function useActivityMap(): Map<LocalDate, DayActivity> {
  const tasks = useStore((s) => s.db.tasks);
  const occurrences = useStore((s) => s.db.occurrences);
  const focusSessions = useStore((s) => s.db.focusSessions);
  const history = useStore((s) => s.db.history);

  return useMemo(
    () => computeActivityMap(tasks, occurrences, focusSessions, history),
    [tasks, occurrences, focusSessions, history],
  );
}

export interface GamificationStats {
  levelInfo: LevelInfo;
  streaks: StreakInfo;
  totalXp: number;
  activityMap: Map<LocalDate, DayActivity>;
}

/**
 * Computes user level, total XP, current/longest streaks, and active status.
 */
export function useGamificationStats(): GamificationStats {
  const activityMap = useActivityMap();
  const now = useNow();
  const today = toLocalDate(now);

  return useMemo(() => {
    const totalXp = calculateTotalXp(activityMap);
    const levelInfo = calculateLevel(totalXp);
    const streaks = computeStreaks(activityMap, today);
    return {
      levelInfo,
      streaks,
      totalXp,
      activityMap,
    };
  }, [activityMap, today]);
}

/**
 * 7-day stats ending on today for mini bar chart.
 */
export function useWeeklyStatsHook(daysCount = 7): WeeklyDayStat[] {
  const activityMap = useActivityMap();
  const now = useNow();
  const today = toLocalDate(now);

  return useMemo(
    () => computeWeeklyStats(activityMap, today, daysCount),
    [activityMap, today, daysCount],
  );
}

export interface HeatmapDay {
  date: LocalDate;
  dayOfWeek: number; // 0 = Sun..6 = Sat
  activity: DayActivity | null;
  isToday: boolean;
  isFuture: boolean;
}

export interface HeatmapWeek {
  weekIndex: number;
  days: HeatmapDay[];
  monthLabel?: string;
}

/**
 * Generates weeks grid structure for the GitHub-style Heatmap (past N weeks ending this week).
 */
export function useActivityHeatmapWeeks(weeksCount = 20): HeatmapWeek[] {
  const activityMap = useActivityMap();
  const now = useNow();
  const today = toLocalDate(now);

  return useMemo(() => {
    const todayObj = new Date(today + "T00:00:00");
    // Align end of grid with the end of current week (Sunday = 0, Monday = 1.. Saturday = 6)
    // In GitHub heatmap, columns are weeks (Mon-Sun or Sun-Sat). Let's use Monday as day 0 of week column.
    const currentDayOfWeek = todayObj.getDay(); // 0 is Sunday, 1 is Monday ...
    const offsetToWeekEnd =
      (7 - (currentDayOfWeek === 0 ? 7 : currentDayOfWeek)) % 7; // days until Sunday
    const gridEndDate = addDaysLocal(today, offsetToWeekEnd);

    const totalDays = weeksCount * 7;
    const gridStartDate = addDaysLocal(gridEndDate, -(totalDays - 1));

    const weeks: HeatmapWeek[] = [];
    let lastMonth = -1;

    for (let w = 0; w < weeksCount; w++) {
      const days: HeatmapDay[] = [];
      let weekMonthLabel: string | undefined = undefined;

      for (let d = 0; d < 7; d++) {
        const dayOffset = w * 7 + d;
        const date = addDaysLocal(gridStartDate, dayOffset);
        const dayObj = new Date(date + "T00:00:00");
        const month = dayObj.getMonth();

        // If the month changed on the first day or middle of the week, add month label
        if (d === 0 && month !== lastMonth) {
          weekMonthLabel = dayObj.toLocaleString(localeTag(), { month: "short" });
          lastMonth = month;
        }

        const isToday = date === today;
        const isFuture = date > today;
        const activity = activityMap.get(date) ?? null;

        days.push({
          date,
          dayOfWeek: dayObj.getDay(),
          activity,
          isToday,
          isFuture,
        });
      }

      weeks.push({
        weekIndex: w,
        days,
        monthLabel: weekMonthLabel,
      });
    }

    return weeks;
  }, [activityMap, today, weeksCount]);
}
