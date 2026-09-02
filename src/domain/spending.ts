import { daysBetween } from "./datetime";
import { expandInstalments } from "./instalments";
import { fold } from "./merchant";
import type { BudgetCategory, Transaction } from "./money";
import type { LocalDate } from "./types";

/**
 * What the money actually went on.
 *
 * The budget view already answers "how much on groceries". This module answers
 * the question underneath it — *which shops* that total is made of — because
 * those are two different decisions. "Market: 8.400 ₺" tells you nothing you
 * can act on; "Migros 5.100, CarrefourSA 2.300, the corner shop 1.000" tells
 * you where to look first.
 *
 * Two rules shape everything here:
 *
 *  - **Totals are net.** A refund is money coming back from a shop, so it is
 *    subtracted from what was spent there rather than filed as income. A
 *    ledger that reports the gross is reporting a number the bank never
 *    charged you.
 *  - **Every level sums to its parent.** Merchant slices add up to their
 *    category, categories add up to the total. A breakdown whose parts do not
 *    add up is a breakdown nobody checks twice.
 */

export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

export interface MerchantSlice {
  /** Canonical merchant, or the entry's note when it was typed by hand. */
  merchant: string;
  /** Spent minus refunded. This is the number that matters. */
  amountMinor: number;
  grossMinor: number;
  refundMinor: number;
  count: number;
  /** Fraction of the category it belongs to, 0..1. */
  share: number;
  firstDate: LocalDate;
  lastDate: LocalDate;
  /** Average per purchase, on gross — an average of a net is not a receipt. */
  averageMinor: number;
  categoryId: string | null;
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  amountMinor: number;
  count: number;
  /** Fraction of the report total, 0..1. */
  share: number;
  /** Sorted by size: the shops this category is actually made of. */
  merchants: MerchantSlice[];
  /** Same category in the comparison window, when one was given. */
  previousMinor: number | null;
  /** (now - before) / before. `null` when there is nothing to compare to. */
  changeRatio: number | null;
}

export interface SpendingReport {
  range: DateRange;
  /** Net: what was spent, less what came back. */
  totalMinor: number;
  /** Before refunds. The budget bars measure limits against this. */
  grossMinor: number;
  refundMinor: number;
  categories: CategorySlice[];
  /** Every merchant across every category, biggest first. */
  merchants: MerchantSlice[];
  byMonth: { month: string; amountMinor: number }[];
  dayCount: number;
  perDayMinor: number;
  biggest: { merchant: string; amountMinor: number; date: LocalDate } | null;
  previousTotalMinor: number | null;
  changeRatio: number | null;
}

export interface AnalyseOptions {
  /** An earlier window to measure this one against. */
  compareWith?: DateRange | null;
}

const UNCATEGORISED = "__none__";

export function inRange(date: LocalDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/**
 * The merchant an entry belongs to.
 *
 * Imported entries carry one. Hand-typed ones do not, so their note stands in —
 * which is exactly right: someone who wrote "kahve" three times has told us the
 * grouping they had in mind.
 */
export function merchantOf(entry: Transaction): string {
  const merchant = entry.merchant?.trim();
  if (merchant) return merchant;
  const note = entry.note.trim();
  return note || "—";
}

interface Bucket {
  grossMinor: number;
  refundMinor: number;
  count: number;
  firstDate: LocalDate;
  lastDate: LocalDate;
}

function emptyBucket(date: LocalDate): Bucket {
  return { grossMinor: 0, refundMinor: 0, count: 0, firstDate: date, lastDate: date };
}

function absorb(bucket: Bucket, entry: Transaction): void {
  if (entry.flow === "EXPENSE") {
    bucket.grossMinor += entry.amountMinor;
    bucket.count += 1;
  } else {
    // Money coming back from a shop is negative spending, not income.
    bucket.refundMinor += entry.amountMinor;
  }
  if (entry.date < bucket.firstDate) bucket.firstDate = entry.date;
  if (entry.date > bucket.lastDate) bucket.lastDate = entry.date;
}

/**
 * Entries that count as spending at a merchant.
 *
 * Income is included only when it can be matched to a shop — a refund. A salary
 * has no merchant and no business in a spending report.
 */
function spendingEntries(rows: Transaction[], range: DateRange): Transaction[] {
  // A purchase on instalments counts here as the charge that falls in this
  // window, not as its price — the same rule the month totals follow, and they
  // have to agree or the breakdown stops summing to the number above it.
  const transactions = expandInstalments(rows);

  const merchantsWithSpend = new Set<string>();
  for (const entry of transactions) {
    if (entry.deletedAt !== null || entry.flow !== "EXPENSE") continue;
    if (!inRange(entry.date, range)) continue;
    merchantsWithSpend.add(fold(merchantOf(entry)));
  }

  return transactions.filter((entry) => {
    if (entry.deletedAt !== null || !inRange(entry.date, range)) return false;
    if (entry.flow === "EXPENSE") return true;
    if (entry.flow !== "INCOME") return false;
    // An income row is a refund when the same shop was also paid something.
    return merchantsWithSpend.has(fold(merchantOf(entry)));
  });
}

function totalOver(transactions: Transaction[], range: DateRange): number {
  let total = 0;
  for (const entry of spendingEntries(transactions, range)) {
    total += entry.flow === "EXPENSE" ? entry.amountMinor : -entry.amountMinor;
  }
  return total;
}

export function analyseSpending(
  transactions: Transaction[],
  categories: BudgetCategory[],
  range: DateRange,
  options: AnalyseOptions = {},
): SpendingReport {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const entries = spendingEntries(transactions, range);

  const perCategory = new Map<string, Bucket>();
  const perMerchant = new Map<string, Bucket & { categoryId: string | null; label: string }>();
  const perMonth = new Map<string, number>();
  let biggest: SpendingReport["biggest"] = null;

  for (const entry of entries) {
    const categoryKey = entry.categoryId ?? UNCATEGORISED;
    const category = perCategory.get(categoryKey) ?? emptyBucket(entry.date);
    absorb(category, entry);
    perCategory.set(categoryKey, category);

    const label = merchantOf(entry);
    // Keyed by category as well as name: the same shop can legitimately sit in
    // two categories, and merging them would make a slice that sums to neither.
    const merchantKey = `${categoryKey}::${fold(label)}`;
    const merchant =
      perMerchant.get(merchantKey) ??
      Object.assign(emptyBucket(entry.date), {
        categoryId: entry.categoryId ?? null,
        label,
      });
    absorb(merchant, entry);
    perMerchant.set(merchantKey, merchant);

    const month = entry.date.slice(0, 7);
    const delta = entry.flow === "EXPENSE" ? entry.amountMinor : -entry.amountMinor;
    perMonth.set(month, (perMonth.get(month) ?? 0) + delta);

    if (entry.flow === "EXPENSE" && (!biggest || entry.amountMinor > biggest.amountMinor)) {
      biggest = { merchant: label, amountMinor: entry.amountMinor, date: entry.date };
    }
  }

  const grossMinor = [...perCategory.values()].reduce(
    (sum, bucket) => sum + bucket.grossMinor,
    0,
  );
  const refundMinor = [...perCategory.values()].reduce(
    (sum, bucket) => sum + bucket.refundMinor,
    0,
  );
  const totalMinor = grossMinor - refundMinor;

  const merchantSlices = [...perMerchant.entries()].map(([key, bucket]) =>
    toMerchantSlice(key, bucket, perCategory),
  );

  const previousRange = options.compareWith ?? null;
  const previousByCategory = previousRange
    ? categoryTotals(transactions, previousRange)
    : null;

  const categorySlices: CategorySlice[] = [...perCategory.entries()]
    .map(([categoryId, bucket]) => {
      const category = categoryId === UNCATEGORISED ? null : categoryById.get(categoryId);
      const amountMinor = bucket.grossMinor - bucket.refundMinor;
      const previousMinor = previousByCategory?.get(categoryId) ?? null;
      return {
        categoryId: categoryId === UNCATEGORISED ? null : categoryId,
        name: category?.name ?? "",
        color: category?.color ?? "#94a3b8",
        icon: category?.icon ?? "•",
        amountMinor,
        count: bucket.count,
        share: totalMinor > 0 ? amountMinor / totalMinor : 0,
        merchants: merchantSlices
          .filter((slice) => (slice.categoryId ?? UNCATEGORISED) === categoryId)
          .sort((a, b) => b.amountMinor - a.amountMinor),
        previousMinor,
        changeRatio:
          previousMinor && previousMinor !== 0
            ? (amountMinor - previousMinor) / previousMinor
            : null,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const dayCount = Math.max(1, daysBetween(range.from, range.to) + 1);
  const previousTotalMinor = previousRange ? totalOver(transactions, previousRange) : null;

  return {
    range,
    totalMinor,
    grossMinor,
    refundMinor,
    categories: categorySlices,
    merchants: merchantSlices.sort((a, b) => b.amountMinor - a.amountMinor),
    byMonth: [...perMonth.entries()]
      .map(([month, amountMinor]) => ({ month, amountMinor }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    dayCount,
    perDayMinor: Math.round(totalMinor / dayCount),
    biggest,
    previousTotalMinor,
    changeRatio:
      previousTotalMinor && previousTotalMinor !== 0
        ? (totalMinor - previousTotalMinor) / previousTotalMinor
        : null,
  };
}

function toMerchantSlice(
  key: string,
  bucket: Bucket & { categoryId: string | null; label: string },
  perCategory: Map<string, Bucket>,
): MerchantSlice {
  const categoryKey = key.slice(0, key.indexOf("::"));
  const parent = perCategory.get(categoryKey);
  const parentTotal = parent ? parent.grossMinor - parent.refundMinor : 0;
  const amountMinor = bucket.grossMinor - bucket.refundMinor;

  return {
    merchant: bucket.label,
    amountMinor,
    grossMinor: bucket.grossMinor,
    refundMinor: bucket.refundMinor,
    count: bucket.count,
    share: parentTotal > 0 ? amountMinor / parentTotal : 0,
    firstDate: bucket.firstDate,
    lastDate: bucket.lastDate,
    averageMinor: bucket.count > 0 ? Math.round(bucket.grossMinor / bucket.count) : 0,
    categoryId: bucket.categoryId,
  };
}

function categoryTotals(
  transactions: Transaction[],
  range: DateRange,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of spendingEntries(transactions, range)) {
    const key = entry.categoryId ?? UNCATEGORISED;
    const delta = entry.flow === "EXPENSE" ? entry.amountMinor : -entry.amountMinor;
    totals.set(key, (totals.get(key) ?? 0) + delta);
  }
  return totals;
}

/**
 * One merchant's total, wherever it sits.
 *
 * "How much at Migros" is a different question from "how much on groceries",
 * and this is the one that answers it — across categories, so a shop filed
 * under two of them still reports one number.
 */
export function merchantTotal(
  report: SpendingReport,
  merchant: string,
): { amountMinor: number; count: number; categories: string[] } {
  const wanted = fold(merchant);
  const slices = report.merchants.filter((slice) => fold(slice.merchant) === wanted);
  return {
    amountMinor: slices.reduce((sum, slice) => sum + slice.amountMinor, 0),
    count: slices.reduce((sum, slice) => sum + slice.count, 0),
    categories: slices.map((slice) => slice.categoryId ?? UNCATEGORISED),
  };
}

/** Merchants matching a search, for the "just Migros" box. */
export function searchMerchants(
  report: SpendingReport,
  query: string,
): MerchantSlice[] {
  const needle = fold(query.trim());
  if (!needle) return report.merchants;
  return report.merchants.filter((slice) => fold(slice.merchant).includes(needle));
}
