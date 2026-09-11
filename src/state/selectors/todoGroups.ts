import { useNow } from "../store";
import {
  addDaysLocal,
  toLocalDate,
} from "@/domain/datetime";
import {
  enclosingPlan,
  instancesInRange,
  representativeInstance,
} from "@/domain/task";
import type { LocalDate, Task, TaskInstance } from "@/domain/types";
import { useMemo } from "react";
import {
  matchesFilters,
  type Filters,
} from "./filters";
import { arrangeInstances } from "./ordering";
import { useLiveTasks, useOccurrenceIndex } from "./index";

// The Todo page's buckets, in the order they are shown.
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
interface Horizon {
  today: LocalDate;
  tomorrow: LocalDate;
  weekEnd: LocalDate;
}

/** Which bucket an open instance belongs in, by how far off its date is. */
function bucketFor(
  instance: TaskInstance,
  horizon: Horizon,
  showCompleted: boolean,
): string | null {
  if (instance.status === "COMPLETED") return showCompleted ? "completed" : null;
  if (!instance.date) return "someday";
  if (instance.status === "OVERDUE") return "overdue";
  if (instance.date === horizon.today) return "today";
  if (instance.date === horizon.tomorrow) return "tomorrow";
  return instance.date <= horizon.weekEnd ? "week" : "later";
}

/**
 * Does this task reach the todo groups at all?
 *
 * Notes render in their own view. Only *scheduled* steps of a plan appear, at
 * whatever depth they sit — an ordinary subtask belongs inside its task — and a
 * plan itself needs a date of its own.
 */
function listedInTodo(
  task: Task,
  parents: Map<string, Task>,
  filters: Filters,
): boolean {
  if (task.tags.includes("note")) return false;
  if (task.parentId) {
    if (!task.dueDate || !enclosingPlan(task, parents)) return false;
  } else if (task.tags.includes("plan") && !task.dueDate) {
    return false;
  }
  return matchesFilters(task, filters);
}

export function useTodoGroups(filters: Filters): TodoGroup[] {
  const tasks = useLiveTasks();
  const occurrences = useOccurrenceIndex();
  const now = useNow();

  return useMemo(() => {
    const today = toLocalDate(now);
    const horizon: Horizon = {
      today,
      tomorrow: addDaysLocal(today, 1),
      weekEnd: addDaysLocal(today, 7),
    };
    const buckets = new Map<string, TaskInstance[]>(
      TODO_GROUPS.map(([id]) => [id, []]),
    );

    // One row per task *per day*: the same run must never be listed twice
    // because it is both the representative and today's occurrence.
    const seen = new Set<string>();
    const place = (instance: TaskInstance) => {
      // A deadline is a date, not a todo. It reaches these screens through
      // `useDeadlineMarkers`, which the views draw as markers — dropping it
      // into a bucket here is what made a date look like one more thing to do.
      if (instance.deadlineOnly) return;
      const key = `${instance.task.id}:${instance.date ?? "someday"}`;
      if (seen.has(key)) return;
      seen.add(key);
      const bucket = bucketFor(instance, horizon, filters.showCompleted);
      if (bucket) buckets.get(bucket)?.push(instance);
    };

    const parents = new Map(tasks.map((t) => [t.id, t]));
    for (const task of tasks) {
      if (!listedInTodo(task, parents, filters)) continue;

      // The oldest run still open is what a task shows when it shows once.
      place(representativeInstance(task, occurrences, now));

      // …but a task can be put on extra days of its own week, and those days
      // are the entire point of that feature: if the calendar draws this task
      // on Wednesday, "Tomorrow" has to list it on Wednesday too. Only the two
      // day-level buckets are filled per occurrence — Week and Later stay one
      // row per task, or a daily habit would fill them with itself.
      for (const instance of instancesInRange(
        task,
        today,
        horizon.tomorrow,
        occurrences,
        now,
      )) {
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
