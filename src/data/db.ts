import { createId } from "@/domain/ids";
import type {
  Category,
  FocusSession,
  HistoryEntry,
  Occurrence,
  Reminder,
  Settings,
  Task,
} from "@/domain/types";

export const DB_VERSION = 1;

/** The whole application state as it is written to disk: one document. */
export interface Database {
  version: number;
  tasks: Task[];
  occurrences: Occurrence[];
  reminders: Reminder[];
  categories: Category[];
  history: HistoryEntry[];
  focusSessions: FocusSession[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  weekStartsOn: 1,
  defaultReminderOffset: 10,
  dayStartHour: 7,
  dayEndHour: 22,
  allDayReminderTime: "09:00",
};

export const CATEGORY_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#64748b",
];

export function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    tasks: [],
    occurrences: [],
    reminders: [],
    categories: defaultCategories(),
    history: [],
    focusSessions: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function defaultCategories(): Category[] {
  return [
    { id: createId("c"), name: "Work", color: "#3b82f6", order: 0 },
    { id: createId("c"), name: "Personal", color: "#22c55e", order: 1 },
    { id: createId("c"), name: "Health", color: "#ec4899", order: 2 },
  ];
}

/**
 * Bring a document read from disk up to the current shape.
 * Unknown/older versions are repaired field-by-field rather than discarded —
 * losing a user's task history is never an acceptable migration outcome.
 */
export function migrate(raw: unknown): Database {
  const base = emptyDatabase();
  if (!raw || typeof raw !== "object") return base;
  const doc = raw as Partial<Database>;

  return {
    version: DB_VERSION,
    tasks: Array.isArray(doc.tasks) ? doc.tasks.map(normaliseTask) : base.tasks,
    occurrences: Array.isArray(doc.occurrences)
      ? doc.occurrences
      : base.occurrences,
    reminders: Array.isArray(doc.reminders) ? doc.reminders : base.reminders,
    categories:
      Array.isArray(doc.categories) && doc.categories.length > 0
        ? doc.categories
        : base.categories,
    history: Array.isArray(doc.history) ? doc.history : base.history,
    focusSessions: Array.isArray(doc.focusSessions)
      ? doc.focusSessions
      : base.focusSessions,
    settings: { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) },
  };
}

function normaliseTask(task: Task): Task {
  return {
    ...task,
    description: task.description ?? "",
    tags: Array.isArray(task.tags) ? task.tags : [],
    priority: task.priority ?? "NONE",
    status: task.status ?? "TODO",
    allDay: task.allDay ?? true,
    order: typeof task.order === "number" ? task.order : 0,
    parentId: task.parentId ?? null,
    categoryId: task.categoryId ?? null,
    recurrence: task.recurrence ?? null,
    snoozedUntil: task.snoozedUntil ?? null,
    completedAt: task.completedAt ?? null,
    deletedAt: task.deletedAt ?? null,
  };
}
