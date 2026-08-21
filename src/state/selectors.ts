import { useMemo } from "react";
import { addDaysLocal, toLocalDate } from "@/domain/datetime";
import { occurrenceId } from "@/domain/ids";
import { instancesInRange, representativeInstance } from "@/domain/task";
import type {
  Category,
  FocusSession,
  HistoryEntry,
  LocalDate,
  Occurrence,
  Priority,
  Task,
  TaskInstance,
} from "@/domain/types";
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
  const now = useNow();

  return useMemo(() => {
    const out: TaskInstance[] = [];
    for (const task of tasks) {
      if (task.parentId) continue; // subtasks render nested under their parent
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
    }
    return out.sort(compareInstances);
  }, [tasks, occurrences, from, to, filters, now]);
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
  label: string;
  instances: TaskInstance[];
}

const TODO_GROUPS: [string, string][] = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["week", "Next 7 days"],
  ["later", "Later"],
  ["someday", "No date"],
  ["completed", "Completed"],
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

    for (const task of tasks) {
      if (task.parentId) continue; // subtasks render nested under their parent
      if (task.tags.includes("plan")) continue; // plans render in their own view
      if (!matchesFilters(task, filters)) continue;

      const instance = representativeInstance(task, occurrences, now);
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
    }

    return TODO_GROUPS.map(([id, label]) => ({
      id,
      label,
      instances: (buckets.get(id) ?? []).sort(compareInstances),
    })).filter((group) => group.instances.length > 0);
  }, [tasks, occurrences, filters, now]);
}

export function useSubtasks(parentId: string): Task[] {
  const tasks = useLiveTasks();
  return useMemo(
    () =>
      tasks
        .filter((t) => t.parentId === parentId)
        .sort((a, b) => a.order - b.order),
    [tasks, parentId],
  );
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
  return useMemo(
    () =>
      sessions
        .filter((s) => (taskId ? s.taskId === taskId : true))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [sessions, taskId],
  );
}

export function useTrackedSeconds(taskId: string): number {
  const sessions = useFocusSessions(taskId);
  return useMemo(
    () => sessions.reduce((total, s) => total + s.durationSec, 0),
    [sessions],
  );
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
