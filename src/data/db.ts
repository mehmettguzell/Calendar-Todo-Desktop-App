import { createId } from "@/domain/ids";
import { normaliseLink, type WishlistItem } from "@/domain/wishlist";
import { normaliseLabel, type Deadline } from "@/domain/deadline";
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

export const ENGLISH_TO_TURKISH_CATEGORY_MAP: Record<string, string> = {
  work: "İş",
  personal: "Kişisel",
  health: "Sağlık",
  home: "Ev",
  errands: "Alışveriş",
  shopping: "Alışveriş",
  learning: "Öğrenme",
  study: "Öğrenme",
  travel: "Ulaşım",
  finance: "Finans",
  social: "Sosyal",
  fitness: "Sağlık",
};

export const ENGLISH_TO_TURKISH_BUDGET_MAP: Record<string, string> = {
  salary: "Maaş",
  "side income": "Ek gelir",
  rent: "Kira",
  groceries: "Market",
  transport: "Ulaşım",
  bills: "Faturalar",
  "eating out": "Yeme & içme",
  dining: "Yeme & içme",
  health: "Sağlık",
  fun: "Eğlence",
  entertainment: "Eğlence",
  savings: "Birikim",
  investments: "Yatırım",
  fuel: "Akaryakıt",
  gas: "Akaryakıt",
  clothing: "Giyim",
  subscriptions: "Abonelikler",
  "personal care": "Kişisel bakım",
  education: "Eğitim",
  electronics: "Teknoloji",
  home: "Ev",
  housing: "Kira",
  utilities: "Faturalar",
  "cash withdrawal": "Nakit çekim",
  "bank fees": "Banka ücretleri",
  other: "Diğer",
};

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
    settings: {
      ...DEFAULT_SETTINGS,
      categorySeedVersion: CATEGORY_SEED_VERSION,
    },
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

/**
 * The three categories a fresh document starts with.
 *
 * Named in the language the app is first opened in — they are the first words a
 * new user reads, and English labels in a Turkish sidebar are the loudest kind
 * of half-translation. They stay ordinary user data afterwards: switching
 * language later does not rename them, because by then they may hold work.
 */
/**
 * The categories a brand-new account starts with.
 *
 * Six, not sixteen: a seeded list is a suggestion of how to file things, and a
 * long one reads as a chore to prune. These are the buckets almost everyone
 * turns out to need, and every one of them is an ordinary category afterwards —
 * rename it, recolour it, delete it.
 */
/**
 * The seeded categories, in the rounds they were introduced.
 *
 * Round 0 is what the app has always shipped with. Later rounds are offered to
 * documents that predate them — once each, by `backfillCategories`. Splitting
 * them this way is what lets a new suggestion reach an existing user without
 * the app ever second-guessing a category they chose to delete or rename.
 *
 * To add more later: append a round. Never edit an old one — an existing
 * document has already been past it and will not look again.
 */
const SEED_ROUNDS = [
  {
    tr: ["İş", "Kişisel", "Sağlık"],
    en: ["Work", "Personal", "Health"],
  },
  {
    tr: ["Ev", "Alışveriş", "Öğrenme", "Ulaşım", "Finans", "Sosyal"],
    en: ["Home", "Errands", "Learning", "Travel", "Finance", "Social"],
  },
] as const;

/** The round a fresh document starts at: all of them. */
export const CATEGORY_SEED_VERSION = SEED_ROUNDS.length - 1;

function seedNames(language: "tr" | "en", fromRound = 0): string[] {
  return SEED_ROUNDS.slice(fromRound).flatMap((round) => [...round[language]]);
}

/** Paired with the seeds by position, from the shared palette. */
const SEED_CATEGORY_COLORS = [
  "#3b82f6", // İş
  "#22c55e", // Kişisel
  "#ec4899", // Sağlık
  "#f97316", // Ev
  "#eab308", // Alışveriş
  "#8b5cf6", // Öğrenme
  "#14b8a6", // Ulaşım
  "#64748b", // Finans
  "#ef4444", // Sosyal
];

/** The colour a seeded name always gets, wherever it is created. */
function seedColour(language: "tr" | "en", name: string): string {
  const index = seedNames(language).indexOf(name);
  const slot = index >= 0 ? index : 0;
  return SEED_CATEGORY_COLORS[slot % SEED_CATEGORY_COLORS.length] as string;
}

/**
 * Give an existing document the seed rounds it was created too early to see.
 *
 * Matched by name, not by id: a seeded category gets a fresh id in every
 * document, so an id says nothing about whether this user has met "Ev" before.
 * A name that is already there — however it got there — is left alone, and the
 * version stamp makes sure each round is offered exactly once, so deleting one
 * of these is final rather than an argument the app has with the user weekly.
 */
function backfillCategories(
  categories: Category[],
  seenVersion: number,
  language: "tr" | "en",
): Category[] {
  if (seenVersion >= CATEGORY_SEED_VERSION) return categories;

  const taken = new Set(categories.map((c) => c.name.trim().toLowerCase()));
  const additions = seedNames(language, seenVersion + 1)
    .filter((name) => !taken.has(name.trim().toLowerCase()))
    .map((name, index) => ({
      id: createId("c"),
      name,
      color: seedColour(language, name),
      order: categories.length + index,
    }));

  return additions.length > 0 ? [...categories, ...additions] : categories;
}

function defaultCategories(
  language: "tr" | "en" = DEFAULT_SETTINGS.language ?? "tr",
): Category[] {
  return seedNames(language).map((name, index) => ({
    id: createId("c"),
    name,
    // Modulo so adding a seed can never hand a category `undefined` for a colour.
    color: SEED_CATEGORY_COLORS[index % SEED_CATEGORY_COLORS.length] as string,
    order: index,
  }));
}

export function deduplicateCategories(
  categories: Category[],
  tasks: Task[] = [],
  language: "tr" | "en" = "tr",
): { categories: Category[]; tasks: Task[] } {
  const seen = new Map<string, Category>();
  const idRemap = new Map<string, string>();

  for (const cat of categories) {
    let name = cat.name.trim();
    if (language === "tr") {
      const lower = name.toLowerCase();
      if (ENGLISH_TO_TURKISH_CATEGORY_MAP[lower]) {
        name = ENGLISH_TO_TURKISH_CATEGORY_MAP[lower];
      }
    }
    const key = name.toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...cat, name });
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
      uniqueCategories.length > 0
        ? uniqueCategories
        : defaultCategories(language),
    tasks: remappedTasks,
  };
}

export function deduplicateBudgetCategories(
  categories: BudgetCategory[],
  transactions: Transaction[] = [],
  language: "tr" | "en" = "tr",
): { budgetCategories: BudgetCategory[]; transactions: Transaction[] } {
  const seen = new Map<string, BudgetCategory>();
  const idRemap = new Map<string, string>();

  for (const cat of categories) {
    let name = (cat.name ?? "").trim();
    if (language === "tr") {
      const lower = name.toLowerCase();
      if (ENGLISH_TO_TURKISH_BUDGET_MAP[lower]) {
        name = ENGLISH_TO_TURKISH_BUDGET_MAP[lower];
      }
    }
    const key = `${name.toLowerCase()}::${cat.flow}`;
    if (!name) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...cat, name });
    } else {
      idRemap.set(cat.id, existing.id);
    }
  }

  const unique = Array.from(seen.values()).map((c, idx) => ({
    ...c,
    order: idx,
  }));

  const remappedTxs = transactions.map((t) => {
    if (t.categoryId && idRemap.has(t.categoryId)) {
      return { ...t, categoryId: idRemap.get(t.categoryId)! };
    }
    return t;
  });

  return {
    budgetCategories:
      unique.length > 0 ? unique : defaultBudgetCategories(language),
    transactions: remappedTxs,
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
  /*
   * The bank-mail feed is gone, and so is its configuration.
   *
   * Stripped rather than ignored: the block held a mailbox host and username,
   * and a document that keeps carrying them writes them into every backup the
   * user ever makes, for a feature that no longer exists to read them.
   */
  const { mailSync: _removedMailSync, ...storedSettings } = (doc.settings ??
    {}) as Record<string, unknown>;
  const settings = { ...DEFAULT_SETTINGS, ...storedSettings } as Settings;
  const language = settings.language ?? "tr";

  const storedCategories =
    Array.isArray(doc.categories) && doc.categories.length > 0
      ? doc.categories
      : base.categories;
  // A document written before a seed round existed is offered it now, once.
  const rawCategories = backfillCategories(
    storedCategories,
    doc.settings?.categorySeedVersion ?? 0,
    language,
  );

  const { categories: cleanCategories, tasks: cleanTasks } =
    deduplicateCategories(rawCategories, tasks, language);

  const rawTransactions = Array.isArray(doc.transactions)
    ? doc.transactions.map(normaliseTransaction)
    : base.transactions;

  const rawBudgetCategories = Array.isArray(doc.budgetCategories)
    ? doc.budgetCategories.map(normaliseBudgetCategory)
    : defaultBudgetCategories(language);

  const {
    budgetCategories: cleanBudgetCategories,
    transactions: cleanTransactions,
  } = deduplicateBudgetCategories(
    rawBudgetCategories,
    rawTransactions,
    language,
  );

  return {
    version: DB_VERSION,
    tasks: cleanTasks,
    occurrences: Array.isArray(doc.occurrences)
      ? doc.occurrences.filter(isAddressableOccurrence).map(normaliseOccurrence)
      : base.occurrences,
    reminders: Array.isArray(doc.reminders)
      ? doc.reminders.filter(isAddressableReminder).map(normaliseReminder)
      : base.reminders,
    categories: cleanCategories,
    history: Array.isArray(doc.history) ? doc.history : base.history,
    focusSessions: Array.isArray(doc.focusSessions)
      ? doc.focusSessions
      : base.focusSessions,
    tombstones: Array.isArray(doc.tombstones)
      ? pruneTombstones(doc.tombstones)
      : base.tombstones,
    transactions: cleanTransactions,
    budgetCategories: cleanBudgetCategories,
    wishlist: Array.isArray(doc.wishlist)
      ? doc.wishlist.map(normaliseWishlistItem)
      : base.wishlist,
    // A checkpoint with no name or no day cannot be drawn or read, and one
    // pointing at no task belongs to nothing — all three are dropped rather
    // than carried as rows nothing can ever show.
    deadlines: Array.isArray(doc.deadlines)
      ? doc.deadlines.map(normaliseDeadline).filter(isUsableDeadline)
      : base.deadlines,
    settings: { ...settings, categorySeedVersion: CATEGORY_SEED_VERSION },
  };
}

/**
 * Documents written before occurrences carried a timestamp get one now.
 *
 * The epoch is deliberate: a row with no recorded edit time must lose every
 * conflict against a row that has one, rather than win by accident.
 */
const EPOCH = new Date(0).toISOString();

/**
 * Drop occurrence and reminder rows that name no task.
 *
 * Both are per-task state, addressed as `${taskId}::${date}` and by `taskId`
 * respectively, so a row without one is already invisible to every reader —
 * it cannot be shown, completed, or fired. What it *can* still do is travel:
 * `task_id` is NOT NULL in the cloud, so the row is rejected on every push and
 * takes the whole reconciliation down with it. Discarding it on load loses
 * nothing a user could reach and un-wedges sync on the next pass.
 */
function isAddressableOccurrence(occurrence: Occurrence): boolean {
  return Boolean(occurrence?.taskId) && Boolean(occurrence?.date);
}

function isAddressableReminder(reminder: Reminder): boolean {
  return Boolean(reminder?.taskId);
}

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
  // A row carrying `instalmentIndex` is one monthly charge of a purchase, not
  // a purchase: aggregation makes those and nothing may ever write one back.
  const { instalmentIndex: _derived, ...stored } = t;
  return {
    ...stored,
    instalments:
      typeof t.instalments === "number" && t.instalments > 1
        ? Math.trunc(t.instalments)
        : null,
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

function normaliseWishlistItem(item: WishlistItem): WishlistItem {
  return {
    ...item,
    title: (item.title ?? "").trim(),
    // A price of 0 is a price; "not priced yet" is null, and the two have to
    // stay apart or the total silently counts an unknown as free.
    priceMinor:
      typeof item.priceMinor === "number" && Number.isFinite(item.priceMinor)
        ? Math.round(item.priceMinor)
        : null,
    // Re-checked on the way in rather than trusted: the document is a file on
    // disk, and a link is about to become an href. See `normaliseLink`.
    url: typeof item.url === "string" ? normaliseLink(item.url) : null,
    note: item.note ?? "",
    categoryId: item.categoryId ?? null,
    order: typeof item.order === "number" ? item.order : 0,
    boughtAt: item.boughtAt ?? null,
    transactionId: item.transactionId ?? null,
    updatedAt: item.updatedAt ?? item.createdAt ?? EPOCH,
    deletedAt: item.deletedAt ?? null,
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

function normaliseDeadline(deadline: Deadline): Deadline {
  const at = deadline.createdAt ?? new Date().toISOString();
  return {
    ...deadline,
    label: normaliseLabel(String(deadline.label ?? "")) ?? "",
    order: typeof deadline.order === "number" ? deadline.order : 0,
    completedAt: deadline.completedAt ?? null,
    createdAt: at,
    updatedAt: deadline.updatedAt ?? at,
    deletedAt: deadline.deletedAt ?? null,
  };
}

function isUsableDeadline(deadline: Deadline): boolean {
  return Boolean(deadline.id && deadline.taskId && deadline.label && deadline.date);
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
    manualOrder: typeof task.manualOrder === "number" ? task.manualOrder : null,
    parentId: task.parentId ?? null,
    categoryId: task.categoryId ?? null,
    recurrence: task.recurrence ?? null,
    deadline: task.deadline ?? null,
    estimateMinutes:
      typeof task.estimateMinutes === "number" ? task.estimateMinutes : null,
    snoozedUntil: task.snoozedUntil ?? null,
    completedAt: task.completedAt ?? null,
    deletedAt: task.deletedAt ?? null,
  };
}
