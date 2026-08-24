import { addDaysLocal, fromLocalDate, toLocalDate } from "./datetime";
import { expandOccurrences } from "./recurrence";
import type { Instant, LocalDate, Recurrence } from "./types";

/**
 * Budget: the money side of the same calendar.
 *
 * Amounts are stored as INTEGER MINOR UNITS — kuruş, cents — and never as
 * floating point. `0.1 + 0.2` is the oldest bug in personal finance software,
 * and a budget whose monthly total is off by a few kuruş is a budget nobody
 * trusts twice.
 */

/** What a movement of money does. */
export type MoneyFlow = "INCOME" | "EXPENSE" | "INVESTMENT";

export const MONEY_FLOWS: MoneyFlow[] = ["INCOME", "EXPENSE", "INVESTMENT"];

/**
 * A spending/earning label.
 *
 * The app seeds a useful starting set, but a category the user types becomes a
 * permanent one for that user — the list is theirs, not a fixed enum they have
 * to squeeze their life into.
 */
export interface BudgetCategory {
  id: string;
  name: string;
  flow: MoneyFlow;
  color: string;
  /** A single emoji, purely decorative. */
  icon: string;
  /** `false` for anything the user created, which is what makes it deletable. */
  builtIn: boolean;
  order: number;
  /**
   * A monthly ceiling for this category, in minor units.
   *
   * The thing that turns a ledger into a budget: without it the view can only
   * say where the money went, which is a report about the past rather than a
   * decision about the present.
   */
  monthlyLimitMinor?: number | null;
  updatedAt: Instant;
}

export interface Transaction {
  id: string;
  date: LocalDate;
  /** Always positive; direction lives in `flow`, never in the sign. */
  amountMinor: number;
  flow: MoneyFlow;
  categoryId: string | null;
  note: string;
  /**
   * Makes this entry a template that repeats.
   *
   * Rent and salary are the same number on the same day every month, and typing
   * them in twelve times a year is how a budget stops being kept. The rule lives
   * on the entry itself rather than in a separate table, so a repeating entry is
   * an ordinary entry that happens to have a rule.
   */
  recurrence?: Recurrence | null;
  /** Set on entries produced by a template, pointing back at it. */
  recurrenceSourceId?: string | null;
  /** Template only: the last date it has already produced an entry for. */
  lastGeneratedFor?: LocalDate | null;
  /**
   * Who was paid, canonicalised: "Migros", not "MIGROS TIC.A.S.-ISTANBUL TR".
   *
   * Kept beside `categoryId` rather than folded into it because the two answer
   * different questions. "How much on groceries" is the category; "how much at
   * Migros specifically" is the merchant, and a budget that can only answer the
   * first one cannot tell you which shop the money actually goes to.
   */
  merchant?: string | null;
  /**
   * Identity of the statement row this entry came from.
   *
   * Re-importing the same statement, or an overlapping one, has to be a no-op —
   * a ledger that silently doubles a month is worse than one with a gap.
   */
  externalId?: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  /** Soft delete, like tasks: the record of a month must not silently change. */
  deletedAt: Instant | null;
}

export interface DueRecurrence {
  source: Transaction;
  date: LocalDate;
}

/**
 * Entries a template still owes, up to and including `through`.
 *
 * Templates produce real, editable entries rather than being counted virtually.
 * That distinction is the whole design: rent is *usually* 12.000 and
 * occasionally is not, and an entry you cannot correct is one you stop trusting.
 * Producing it makes the exception a one-field edit instead of an exception in
 * the model.
 *
 * Nothing is ever produced for a future date: a budget that already contains
 * next month's rent is lying about where you stand today.
 */
export function dueRecurringTransactions(
  transactions: Transaction[],
  through: LocalDate,
  horizonDays = 800,
): DueRecurrence[] {
  const due: DueRecurrence[] = [];

  for (const source of transactions) {
    if (!source.recurrence || source.deletedAt !== null) continue;

    // Start the day after whatever it last produced, so nothing is duplicated
    // and nothing is skipped.
    const from = source.lastGeneratedFor
      ? addDaysLocal(source.lastGeneratedFor, 1)
      : source.date;
    if (from > through) continue;

    const dates = expandOccurrences(
      { dueDate: source.date, recurrence: source.recurrence },
      from,
      through,
    ).slice(0, horizonDays);

    for (const date of dates) {
      // The template's own first entry already exists; it is the template.
      if (date === source.date) continue;
      due.push({ source, date });
    }
  }

  return due;
}

export interface LimitStatus {
  limitMinor: number;
  spentMinor: number;
  /** 0..n — above 1 means the ceiling has been passed. */
  ratio: number;
  state: "ok" | "close" | "over";
}

/** How close a category is to its monthly ceiling. */
export function limitStatus(
  limitMinor: number | null | undefined,
  spentMinor: number,
): LimitStatus | null {
  if (!limitMinor || limitMinor <= 0) return null;
  const ratio = spentMinor / limitMinor;
  return {
    limitMinor,
    spentMinor,
    ratio,
    // Warning at 80%: late enough not to cry wolf, early enough that there is
    // still a month left to do something about it.
    state: ratio > 1 ? "over" : ratio >= 0.8 ? "close" : "ok",
  };
}

export type BudgetPeriod = "day" | "week" | "month" | "year";

export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

export interface BudgetSummary {
  income: number;
  expense: number;
  investment: number;
  /**
   * Income minus expense. Investment is deliberately excluded: money moved into
   * an investment has left the month's cash but has not been *spent*, and
   * counting it as a loss makes saving look like overspending.
   */
  net: number;
  /** What actually left the account: expense + investment. */
  outflow: number;
  count: number;
}

export interface CategoryTotal {
  categoryId: string | null;
  amountMinor: number;
  count: number;
  /** 0..1 of the largest total in the same list, for bar widths. */
  share: number;
}

/* ------------------------------------------------------------------ */
/* Parsing and formatting                                              */
/* ------------------------------------------------------------------ */

/**
 * Read an amount the way a person actually types it.
 *
 * Turkish and English write thousands and decimals the other way round
 * (`1.234,56` vs `1,234.56`), and a budget entry box that rejects one of them is
 * a budget entry box that gets abandoned. The rule used here: whichever
 * separator appears LAST is the decimal one.
 *
 * Returns minor units, or `null` when there is no number in the input at all.
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,-]/g, "").trim();
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const digitsAndSeparators = cleaned.replace(/-/g, "");

  const lastComma = digitsAndSeparators.lastIndexOf(",");
  const lastDot = digitsAndSeparators.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot);

  let whole = digitsAndSeparators;
  let fraction = "";

  if (decimalAt !== -1) {
    const tail = digitsAndSeparators.slice(decimalAt + 1);
    // Three digits after the last separator is a thousands group, not cents:
    // "1.234" is one thousand two hundred, not one lira twenty-three.
    if (tail.length !== 3) {
      whole = digitsAndSeparators.slice(0, decimalAt);
      fraction = tail;
    }
  }

  const wholeDigits = whole.replace(/[^0-9]/g, "") || "0";
  const fractionDigits = (fraction.replace(/[^0-9]/g, "") + "00").slice(0, 2);

  const minor = Number(wholeDigits) * 100 + Number(fractionDigits);
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}

/** `123456` → `₺1.234,56`. */
export function formatMoney(
  amountMinor: number,
  currency = "TRY",
  locale?: string,
): string {
  const value = amountMinor / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unknown currency code must not take the whole view down with it.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Compact form for chart labels: `₺1,2B` / `₺12,3K`. */
export function formatMoneyShort(amountMinor: number, currency = "TRY"): string {
  const abs = Math.abs(amountMinor);
  if (abs < 1_000_00) return formatMoney(amountMinor, currency);
  const value = amountMinor / 100;
  const compact =
    abs >= 1_000_000_00
      ? `${(value / 1_000_000).toFixed(1)}M`
      : `${(value / 1_000).toFixed(1)}K`;
  return `${symbolOf(currency)}${compact}`;
}

function symbolOf(currency: string): string {
  const symbols: Record<string, string> = {
    TRY: "₺",
    USD: "$",
    EUR: "€",
    GBP: "£",
  };
  return symbols[currency] ?? `${currency} `;
}

export const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

/** The calendar window a period covers, anchored on a date inside it. */
export function periodRange(
  anchor: LocalDate,
  period: BudgetPeriod,
  weekStartsOn: 0 | 1 = 1,
): DateRange {
  const date = fromLocalDate(anchor);

  switch (period) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const day = date.getDay();
      const backwards = (day - weekStartsOn + 7) % 7;
      const from = addDaysLocal(anchor, -backwards);
      return { from, to: addDaysLocal(from, 6) };
    }
    case "month": {
      const first = new Date(date.getFullYear(), date.getMonth(), 1);
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      return { from: toLocalDate(first), to: toLocalDate(last) };
    }
    case "year":
      return {
        from: toLocalDate(new Date(date.getFullYear(), 0, 1)),
        to: toLocalDate(new Date(date.getFullYear(), 11, 31)),
      };
  }
}

/** Move a period window one step forward or back. */
export function stepPeriod(
  anchor: LocalDate,
  period: BudgetPeriod,
  direction: 1 | -1,
): LocalDate {
  const date = fromLocalDate(anchor);
  switch (period) {
    case "day":
      return addDaysLocal(anchor, direction);
    case "week":
      return addDaysLocal(anchor, 7 * direction);
    case "month":
      return toLocalDate(
        new Date(date.getFullYear(), date.getMonth() + direction, 1),
      );
    case "year":
      return toLocalDate(new Date(date.getFullYear() + direction, date.getMonth(), 1));
  }
}

export function inRange(date: LocalDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

/** Live transactions inside a window, newest first. */
export function transactionsInRange(
  transactions: Transaction[],
  range: DateRange,
): Transaction[] {
  return transactions
    .filter((t) => t.deletedAt === null && inRange(t.date, range))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function summarise(transactions: Transaction[]): BudgetSummary {
  let income = 0;
  let expense = 0;
  let investment = 0;

  for (const t of transactions) {
    if (t.deletedAt !== null) continue;
    if (t.flow === "INCOME") income += t.amountMinor;
    else if (t.flow === "EXPENSE") expense += t.amountMinor;
    else investment += t.amountMinor;
  }

  return {
    income,
    expense,
    investment,
    net: income - expense,
    outflow: expense + investment,
    count: transactions.filter((t) => t.deletedAt === null).length,
  };
}

/** Totals per category for one flow, largest first. */
export function totalsByCategory(
  transactions: Transaction[],
  flow: MoneyFlow,
): CategoryTotal[] {
  const totals = new Map<string | null, { amountMinor: number; count: number }>();

  for (const t of transactions) {
    if (t.deletedAt !== null || t.flow !== flow) continue;
    const key = t.categoryId;
    const bucket = totals.get(key) ?? { amountMinor: 0, count: 0 };
    bucket.amountMinor += t.amountMinor;
    bucket.count += 1;
    totals.set(key, bucket);
  }

  const rows = [...totals.entries()]
    .map(([categoryId, bucket]) => ({ categoryId, ...bucket, share: 0 }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const largest = rows[0]?.amountMinor ?? 0;
  return rows.map((row) => ({
    ...row,
    share: largest > 0 ? row.amountMinor / largest : 0,
  }));
}

export interface DayTotal {
  date: LocalDate;
  income: number;
  expense: number;
  investment: number;
}

/**
 * One bucket per day across a range, including the days with nothing in them.
 *
 * The gaps are the point: a chart that silently drops empty days shows a
 * spending habit that looks steadier than it is.
 */
export function dailyTotals(
  transactions: Transaction[],
  range: DateRange,
  maxDays = 400,
): DayTotal[] {
  const byDate = new Map<LocalDate, DayTotal>();
  let cursor = range.from;
  let guard = 0;
  while (cursor <= range.to && guard < maxDays) {
    byDate.set(cursor, { date: cursor, income: 0, expense: 0, investment: 0 });
    cursor = addDaysLocal(cursor, 1);
    guard += 1;
  }

  for (const t of transactions) {
    if (t.deletedAt !== null) continue;
    const bucket = byDate.get(t.date);
    if (!bucket) continue;
    if (t.flow === "INCOME") bucket.income += t.amountMinor;
    else if (t.flow === "EXPENSE") bucket.expense += t.amountMinor;
    else bucket.investment += t.amountMinor;
  }

  return [...byDate.values()];
}

/** Average daily outflow over a window, for "at this rate…" projections. */
export function burnRatePerDay(
  transactions: Transaction[],
  range: DateRange,
): number {
  const days = dailyTotals(transactions, range).length || 1;
  const { outflow } = summarise(transactions);
  return Math.round(outflow / days);
}

/* ------------------------------------------------------------------ */
/* Seed categories                                                     */
/* ------------------------------------------------------------------ */

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
  | "fees";

interface CatalogueEntry {
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
};

/** What a brand-new document starts with. The rest arrive when they are needed. */
const SEEDED_KEYS: CategoryKey[] = [
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
];

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
  language: "tr" | "en" = "en",
): Omit<BudgetCategory, "id" | "updatedAt">[] {
  return SEEDED_KEYS.map((key, order) => {
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
