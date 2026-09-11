
import type { BudgetCategory, MoneyFlow } from "./money";

// The budget categories a new document starts with, and the rounds that were
// added later. Data plus the seeding rules that read it.
/**
 * A starting set, not a closed list.
 *
 * Enough that the first transaction can be filed without a detour into
 * category management, and every one of them is deletable once the user's own
 * labels take over.
 */
/**
 * Every category the app knows how to name, in both languages.
 *
 * Only a handful ship with a new document (`SEEDED_KEYS`); the rest exist so
 * the statement importer has somewhere to put a petrol station or a streaming
 * subscription. They are created the first time a statement actually contains
 * one — a category list should grow out of what you spend, not out of what the
 * developer imagined you might.
 */
export type CategoryKey =
  | "salary"
  | "sideIncome"
  | "rent"
  | "groceries"
  | "transport"
  | "bills"
  | "eatingOut"
  | "health"
  | "fun"
  | "savings"
  | "investments"
  | "fuel"
  | "clothing"
  | "subscriptions"
  | "personalCare"
  | "education"
  | "electronics"
  | "home"
  | "cash"
  | "fees"
  | "shopping"
  | "tobacco";

export interface CatalogueEntry {
  tr: string;
  en: string;
  flow: MoneyFlow;
  color: string;
  icon: string;
}

export const CATEGORY_CATALOGUE: Record<CategoryKey, CatalogueEntry> = {
  salary: { tr: "Maaş", en: "Salary", flow: "INCOME", color: "#22c55e", icon: "💼" },
  sideIncome: { tr: "Ek gelir", en: "Side income", flow: "INCOME", color: "#14b8a6", icon: "✨" },
  rent: { tr: "Kira", en: "Rent", flow: "EXPENSE", color: "#ef4444", icon: "🏠" },
  groceries: { tr: "Market", en: "Groceries", flow: "EXPENSE", color: "#f97316", icon: "🛒" },
  transport: { tr: "Ulaşım", en: "Transport", flow: "EXPENSE", color: "#eab308", icon: "🚌" },
  bills: { tr: "Faturalar", en: "Bills", flow: "EXPENSE", color: "#8b5cf6", icon: "🧾" },
  eatingOut: { tr: "Yeme & içme", en: "Eating out", flow: "EXPENSE", color: "#ec4899", icon: "🍽️" },
  health: { tr: "Sağlık", en: "Health", flow: "EXPENSE", color: "#06b6d4", icon: "💊" },
  fun: { tr: "Eğlence", en: "Fun", flow: "EXPENSE", color: "#a855f7", icon: "🎬" },
  savings: { tr: "Birikim", en: "Savings", flow: "INVESTMENT", color: "#3b82f6", icon: "🏦" },
  investments: { tr: "Yatırım", en: "Investments", flow: "INVESTMENT", color: "#0ea5e9", icon: "📈" },
  fuel: { tr: "Akaryakıt", en: "Fuel", flow: "EXPENSE", color: "#f59e0b", icon: "⛽" },
  clothing: { tr: "Giyim", en: "Clothing", flow: "EXPENSE", color: "#d946ef", icon: "👕" },
  subscriptions: { tr: "Abonelikler", en: "Subscriptions", flow: "EXPENSE", color: "#6366f1", icon: "🔁" },
  personalCare: { tr: "Kişisel bakım", en: "Personal care", flow: "EXPENSE", color: "#fb7185", icon: "💇" },
  education: { tr: "Eğitim", en: "Education", flow: "EXPENSE", color: "#0891b2", icon: "🎓" },
  electronics: { tr: "Teknoloji", en: "Electronics", flow: "EXPENSE", color: "#64748b", icon: "💻" },
  home: { tr: "Ev", en: "Home", flow: "EXPENSE", color: "#84cc16", icon: "🛋️" },
  cash: { tr: "Nakit çekim", en: "Cash withdrawal", flow: "EXPENSE", color: "#78716c", icon: "🏧" },
  fees: { tr: "Banka ücretleri", en: "Bank fees", flow: "EXPENSE", color: "#94a3b8", icon: "🏛️" },
  /*
   * Alışveriş is deliberately not Giyim and not Market.
   *
   * Those two are what the statement importer can recognise from a shop name;
   * this is the bucket for the rest of a trip out — the thing somebody means
   * when they say "alışveriş yaptım" and it was not food and not clothes.
   */
  shopping: { tr: "Alışveriş", en: "Shopping", flow: "EXPENSE", color: "#f472b6", icon: "🛍️" },
  /*
   * A habit is the one kind of spending where the *count* matters as much as
   * the total, and it disappears inside "Market" — which is exactly where it
   * used to land, being bought in one.
   */
  tobacco: { tr: "Sigara", en: "Tobacco", flow: "EXPENSE", color: "#a16207", icon: "🚬" },
};

/**
 * What a document starts with, in the rounds the suggestions were introduced.
 *
 * The rest of the catalogue arrives when a statement actually needs it. Round
 * 0 is what the app has always shipped; a later round is offered once to a
 * document that predates it — see `backfillBudgetCategories`, and
 * `SEED_ROUNDS` in `data/db.ts`, which does the same for task categories and
 * is where this shape comes from.
 *
 * To add more later: append a round. Never edit an old one — a document that
 * has been past it will not look again, which is what keeps a category
 * somebody deleted from coming back every launch.
 */
const BUDGET_SEED_ROUNDS: CategoryKey[][] = [
  [
    "salary",
    "sideIncome",
    "rent",
    "groceries",
    "transport",
    "bills",
    "eatingOut",
    "health",
    "fun",
    "savings",
    "investments",
  ],
  ["shopping", "tobacco"],
];

/** The round a fresh document starts at: all of them. */
export const BUDGET_SEED_VERSION = BUDGET_SEED_ROUNDS.length - 1;

/** The keys of every round from `fromRound` on. */
export function budgetSeedKeys(fromRound = 0): CategoryKey[] {
  return BUDGET_SEED_ROUNDS.slice(fromRound).flat();
}

/**
 * The name a category key carries in a given language.
 *
 * Both spellings are exported because an existing document may hold either: a
 * user who started the app in English has a category called "Groceries", and
 * the importer has to recognise it rather than create a second one called
 * "Market" beside it.
 */
export function categoryNamesFor(key: CategoryKey): [string, string] {
  const entry = CATEGORY_CATALOGUE[key];
  return [entry.tr, entry.en];
}

export function categoryNameFor(key: CategoryKey, language: "tr" | "en"): string {
  const entry = CATEGORY_CATALOGUE[key];
  return language === "tr" ? entry.tr : entry.en;
}

export function seedBudgetCategories(
  language: "tr" | "en" = "tr",
  fromRound = 0,
): Omit<BudgetCategory, "id" | "updatedAt">[] {
  return budgetSeedKeys(fromRound).map((key, order) => {
    const entry = CATEGORY_CATALOGUE[key];
    return {
      name: language === "tr" ? entry.tr : entry.en,
      flow: entry.flow,
      color: entry.color,
      icon: entry.icon,
      builtIn: true,
      order,
    };
  });
}

export const BUDGET_CATEGORY_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
];
