import { createId } from "@/domain/ids";
import {
  seedBudgetCategories,
  type BudgetCategory,
  type Transaction,
} from "@/domain/money";
import type {
  Category,
  FocusSession,
  HistoryEntry,
  Instant,
  Occurrence,
  Reminder,
  Settings,
  Task,
  Tombstone,
} from "@/domain/types";

export const DB_VERSION = 2;

/** The whole application state as it is written to disk: one document. */
export interface Database {
  version: number;
  tasks: Task[];
  occurrences: Occurrence[];
  reminders: Reminder[];
  categories: Category[];
  history: HistoryEntry[];
  focusSessions: FocusSession[];
  /** Ids that were hard-deleted, so a later sync cannot bring them back. */
  tombstones: Tombstone[];
  /** Budget: money in, money out, money set aside. */
  transactions: Transaction[];
  budgetCategories: BudgetCategory[];
  settings: Settings;
}

/**
 * How long a tombstone is kept.
 *
 * Long enough that a device left switched off over a holiday still learns the
 * row is gone, short enough that the list never becomes a second task table.
 */
export const TOMBSTONE_TTL_DAYS = 90;

export function pruneTombstones(
  tombstones: Tombstone[],
  now: Date = new Date(),
): Tombstone[] {
  const cutoff = new Date(
    now.getTime() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return tombstones.filter((t) => t.at >= cutoff);
}

export function tombstone(kind: Tombstone["kind"], id: string, at: Instant): Tombstone {
  return { kind, id, at };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  language: "tr",
  weekStartsOn: 1,
  currency: "TRY",
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
    tombstones: [],
    transactions: [],
    budgetCategories: defaultBudgetCategories(),
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * The seeded budget labels.
 *
 * Created once, then owned by the user: renaming or deleting one is an ordinary
 * edit, and anything they type becomes a permanent category of their own.
 */
export function defaultBudgetCategories(
  language: "tr" | "en" = DEFAULT_SETTINGS.language ?? "en",
): BudgetCategory[] {
  const at = new Date().toISOString();
  return seedBudgetCategories(language).map((seed) => ({
    ...seed,
    id: createId("b"),
    updatedAt: at,
  }));
}

function defaultCategories(): Category[] {
  return [
    { id: createId("c"), name: "Work", color: "#3b82f6", order: 0 },
    { id: createId("c"), name: "Personal", color: "#22c55e", order: 1 },
    { id: createId("c"), name: "Health", color: "#ec4899", order: 2 },
  ];
}

export function deduplicateCategories(
  categories: Category[],
  tasks: Task[] = [],
): { categories: Category[]; tasks: Task[] } {
  const seen = new Map<string, Category>();
  const idRemap = new Map<string, string>();

  for (const cat of categories) {
    const key = cat.name.trim().toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...cat, name: cat.name.trim() });
    } else {
      idRemap.set(cat.id, existing.id);
    }
  }

  const uniqueCategories = Array.from(seen.values()).map((c, idx) => ({
    ...c,
    order: idx,
  }));

  const remappedTasks = tasks.map((t) => {
    if (t.categoryId && idRemap.has(t.categoryId)) {
      return { ...t, categoryId: idRemap.get(t.categoryId)! };
    }
    return t;
  });

  return {
    categories:
      uniqueCategories.length > 0 ? uniqueCategories : defaultCategories(),
    tasks: remappedTasks,
  };
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

  const tasks = Array.isArray(doc.tasks)
    ? doc.tasks.map(normaliseTask)
    : base.tasks;
  const rawCategories =
    Array.isArray(doc.categories) && doc.categories.length > 0
      ? doc.categories
      : base.categories;

  const { categories: cleanCategories, tasks: cleanTasks } =
    deduplicateCategories(rawCategories, tasks);

  return {
    version: DB_VERSION,
    tasks: cleanTasks,
    occurrences: Array.isArray(doc.occurrences)
      ? doc.occurrences.map(normaliseOccurrence)
      : base.occurrences,
    reminders: Array.isArray(doc.reminders)
      ? doc.reminders.map(normaliseReminder)
      : base.reminders,
    categories: cleanCategories,
    history: Array.isArray(doc.history) ? doc.history : base.history,
    focusSessions: Array.isArray(doc.focusSessions)
      ? doc.focusSessions
      : base.focusSessions,
    tombstones: Array.isArray(doc.tombstones)
      ? pruneTombstones(doc.tombstones)
      : base.tombstones,
    transactions: Array.isArray(doc.transactions)
      ? doc.transactions.map(normaliseTransaction)
      : base.transactions,
    // An older document has no budget yet, so it gets the seeded set. An empty
    // array is a deliberate state (the user deleted them all) and is kept.
    budgetCategories: Array.isArray(doc.budgetCategories)
      ? doc.budgetCategories.map(normaliseBudgetCategory)
      : defaultBudgetCategories(doc.settings?.language ?? "en"),
    settings: { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) },
  };
}

/**
 * Documents written before occurrences carried a timestamp get one now.
 *
 * The epoch is deliberate: a row with no recorded edit time must lose every
 * conflict against a row that has one, rather than win by accident.
 */
const EPOCH = new Date(0).toISOString();

function normaliseOccurrence(occurrence: Occurrence): Occurrence {
  return { ...occurrence, updatedAt: occurrence.updatedAt ?? EPOCH };
}

function normaliseReminder(reminder: Reminder): Reminder {
  return {
    ...reminder,
    updatedAt: reminder.updatedAt ?? reminder.createdAt ?? EPOCH,
  };
}

function normaliseTransaction(t: Transaction): Transaction {
  return {
    ...t,
    amountMinor: Math.round(Number(t.amountMinor) || 0),
    note: t.note ?? "",
    flow: t.flow ?? "EXPENSE",
    categoryId: t.categoryId ?? null,
    recurrence: t.recurrence ?? null,
    recurrenceSourceId: t.recurrenceSourceId ?? null,
    lastGeneratedFor: t.lastGeneratedFor ?? null,
    deletedAt: t.deletedAt ?? null,
    updatedAt: t.updatedAt ?? t.createdAt ?? EPOCH,
  };
}

function normaliseBudgetCategory(c: BudgetCategory): BudgetCategory {
  return {
    ...c,
    name: (c.name ?? "").trim(),
    flow: c.flow ?? "EXPENSE",
    icon: c.icon ?? "•",
    builtIn: Boolean(c.builtIn),
    order: typeof c.order === "number" ? c.order : 0,
    monthlyLimitMinor:
      typeof c.monthlyLimitMinor === "number" ? c.monthlyLimitMinor : null,
    updatedAt: c.updatedAt ?? EPOCH,
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
    estimateMinutes:
      typeof task.estimateMinutes === "number" ? task.estimateMinutes : null,
    snoozedUntil: task.snoozedUntil ?? null,
    completedAt: task.completedAt ?? null,
    deletedAt: task.deletedAt ?? null,
  };
}
