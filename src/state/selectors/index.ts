import { useMemo } from "react";
import type { Deadline } from "@/domain/deadline";
import { EMPTY_FILTERS, matchesFilters, type Filters } from "./filters";
import { compareInstances } from "./ordering";
import { useDeadlineIndex } from "./lookups";
import {
  toLocalDate,
} from "@/domain/datetime";
import {
  namedDeadlineKey,
} from "@/domain/ids";
import {
  enclosingPlan,
  instancesInRange,
  toInstance,
} from "@/domain/task";
import type {
  Category,
  LocalDate,
  Occurrence,
  Task,
  TaskInstance,
} from "@/domain/types";
import { useNow, useStore } from "../store";

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
/**
 * A task's checkpoints, drawn like its own deadline: once, on the day they
 * fall, under their own name.
 *
 * Markers rather than work, so they never paint the days leading up to them and
 * never become a second row for the task on a day it already occupies.
 */
function checkpointMarkers(
  task: Task,
  deadlines: Deadline[],
  window: { from: LocalDate; to: LocalDate; showCompleted: boolean; now: Date },
): TaskInstance[] {
  return deadlines
    .filter(
      (deadline) =>
        deadline.date >= window.from &&
        deadline.date <= window.to &&
        (window.showCompleted || deadline.completedAt === null),
    )
    .map((deadline) => ({
      ...toInstance(task, deadline.date, null, window.now),
      key: namedDeadlineKey(task.id, deadline.id),
      isDeadline: true,
      deadlineOnly: true,
      deadlineId: deadline.id,
      deadlineLabel: deadline.label,
      deadlineMet: deadline.completedAt !== null,
    }));
}

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
    const parents = new Map(tasks.map((t) => [t.id, t]));

    for (const task of tasks) {
      // Regular subtasks are hidden from the calendar; they only render inside
      // their parent. A plan's steps are allowed to show up on it, including a
      // step's own steps — they are as much part of the plan.
      if (task.parentId && !enclosingPlan(task, parents)) continue;
      if (!matchesFilters(task, filters)) continue;

      for (const instance of instancesInRange(task, from, to, occurrences, now)) {
        if (!filters.showCompleted && instance.status === "COMPLETED") continue;
        out.push(instance);
      }
      out.push(
        ...checkpointMarkers(task, deadlineIndex.get(task.id) ?? [], {
          from,
          to,
          showCompleted: filters.showCompleted,
          now,
        }),
      );
    }
    return out.sort(compareInstances);
  }, [tasks, occurrences, deadlineIndex, from, to, filters, now]);
}

/**
 * The deadlines falling in a window, as markers rather than as work.
 *
 * Two kinds land here and they read the same: a task's own `deadline` (the day
 * the whole thing stops being on time) and each named checkpoint under it
 * ("Backend bitecek"). Neither is a day the task occupies — see
 * `TaskInstance.deadlineOnly` — so neither belongs in a list of things to do,
 * and a list-shaped view asks for them separately.
 *
 * Sorted with the missed ones first: a date already gone is the only one on
 * this list that changes what you would do next.
 */
export function deadlineMarkersOf(
  instances: TaskInstance[],
  today: LocalDate,
): TaskInstance[] {
  return instances
    .filter((instance) => instance.deadlineOnly)
    .sort((a, b) => {
      const aMissed = (a.date ?? "") < today;
      const bMissed = (b.date ?? "") < today;
      if (aMissed !== bMissed) return aMissed ? -1 : 1;
      return (a.date ?? "").localeCompare(b.date ?? "");
    });
}

export function useDeadlineMarkers(
  from: LocalDate,
  to: LocalDate,
  filters: Filters = EMPTY_FILTERS,
): TaskInstance[] {
  const instances = useInstancesInRange(from, to, filters);
  const now = useNow();
  return useMemo(
    () => deadlineMarkersOf(instances, toLocalDate(now)),
    [instances, now],
  );
}

// The rest of the module, grouped by what it answers.
export * from "./filters";
export * from "./ordering";
export * from "./lookups";
export * from "./todoGroups";
export * from "./stats";
