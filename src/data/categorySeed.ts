import { createId } from "@/domain/ids";
import {
  BUDGET_SEED_VERSION,
  seedBudgetCategories,
  type BudgetCategory,
  type Transaction,
} from "@/domain/money";
import {
  Category,
  Task,
} from "@/domain/types";
import { DEFAULT_SETTINGS } from "./db";

// The categories a document starts with, the rounds added since, and how two
// spellings of the same name are folded back into one.
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
export function backfillCategories(
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

export function defaultCategories(
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

/**
 * Give an existing document the budget seed rounds it was created too early
 * to see.
 *
 * The same rule as `backfillCategories`, for the same reason: matched by name
 * because a seeded category gets a fresh id in every document, offered exactly
 * once because "you have never been shown Sigara" and "you were, and you
 * deleted it" have to stay different answers.
 */
export function backfillBudgetCategories(
  categories: BudgetCategory[],
  seenVersion: number,
  language: "tr" | "en",
): BudgetCategory[] {
  if (seenVersion >= BUDGET_SEED_VERSION) return categories;

  const taken = new Set(
    categories.map((c) => `${(c.name ?? "").trim().toLowerCase()}::${c.flow}`),
  );
  const at = new Date().toISOString();
  const additions = seedBudgetCategories(language, seenVersion + 1)
    .filter((seed) => !taken.has(`${seed.name.trim().toLowerCase()}::${seed.flow}`))
    .map((seed, index) => ({
      ...seed,
      id: createId("b"),
      order: categories.length + index,
      updatedAt: at,
    }));

  return additions.length > 0 ? [...categories, ...additions] : categories;
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
