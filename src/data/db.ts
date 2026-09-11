import {
  type WishlistItem,
} from "@/domain/wishlist";
import {
  type Deadline,
} from "@/domain/deadline";
import type { StatementBatch } from "@/domain/statementBatch";
import {
  BUDGET_SEED_VERSION,
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
import {
  CATEGORY_SEED_VERSION,
  defaultBudgetCategories,
  defaultCategories,
} from "./categorySeed";

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
  /** Things the user means to buy: money that has not moved yet. */
  wishlist: WishlistItem[];
  /** The dated checkpoints tasks are broken into. See `domain/deadline`. */
  deadlines: Deadline[];
  /** Statement imports, kept so one can be taken back. See `statementBatch`. */
  statementBatches: StatementBatch[];
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

export function tombstone(
  kind: Tombstone["kind"],
  id: string,
  at: Instant,
): Tombstone {
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
    wishlist: [],
    deadlines: [],
    statementBatches: [],
    settings: {
      ...DEFAULT_SETTINGS,
      categorySeedVersion: CATEGORY_SEED_VERSION,
      budgetCategorySeedVersion: BUDGET_SEED_VERSION,
    },
  };
}

// Seeding, de-duplication and migration moved to their own modules; they are
// still part of this module's surface, so callers keep reaching them from here.
export { CATEGORY_SEED_VERSION };
export {
  deduplicateBudgetCategories,
  deduplicateCategories,
  defaultBudgetCategories,
  ENGLISH_TO_TURKISH_BUDGET_MAP,
  ENGLISH_TO_TURKISH_CATEGORY_MAP,
} from "./categorySeed";
export { migrate } from "./migrate";
