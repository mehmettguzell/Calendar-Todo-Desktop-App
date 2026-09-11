import {
  Priority,
  Task,
} from "@/domain/types";

// What the toolbar narrows a list down to.
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

export function priorityRank(priority: Priority): number {
  return { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 }[priority];
}
