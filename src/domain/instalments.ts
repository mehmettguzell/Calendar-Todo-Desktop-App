import { addMonths } from "date-fns";
import { fromLocalDate, toLocalDate } from "./datetime";
import type { Transaction } from "./money";
import type { LocalDate } from "./types";

/**
 * Buying now and paying monthly.
 *
 * A 12.000 ₺ phone on twelve instalments is not 12.000 ₺ of spending in
 * August. The bank charges 1.000 in August and 1.000 in each of the eleven
 * months after it. A budget that files the sticker price in the month of
 * purchase reports a catastrophic August followed by eleven months that look
 * free — which is the opposite of what happened, and it poisons every number
 * built on top: the month totals, the category limits, the burn rate, the
 * comparison against last month.
 *
 * So the purchase is stored once and whole, with the number of instalments
 * beside it — that is what the user actually did, and the price is a fact
 * about it — and every total is built from the *charges* it produces rather
 * than from the row itself. One purchase, one record, twelve monthly
 * consequences: the same rule the task side of the app follows for a task that
 * repeats.
 *
 * Nothing here writes anything. A plan that produced twelve real rows would
 * have to keep them in step with the purchase forever, and would put money in
 * the ledger that the bank has not charged yet.
 */

/**
 * As many months as a card will actually spread a purchase over.
 *
 * A ceiling exists because this number comes from a text field, and a typo
 * that turns 12 into 12000 would otherwise expand one purchase into twelve
 * thousand charges in the middle of a render.
 */
export const MAX_INSTALMENTS = 60;

/** How many monthly charges the purchase is split into. 1 when it is not. */
export function instalmentCount(entry: Pick<Transaction, "instalments">): number {
  const raw = entry.instalments;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_INSTALMENTS);
}

export function isInstalment(entry: Pick<Transaction, "instalments">): boolean {
  return instalmentCount(entry) > 1;
}

/**
 * The price split into whole minor units that add back up to it.
 *
 * 100,00 over three months is 33,34 + 33,33 + 33,33, never 33,33 three times:
 * the kuruş that division loses has to be charged to somebody, and the first
 * instalment is where a bank puts it. Every part is computed here rather than
 * rounded at the point of use, because twelve independently rounded numbers
 * stop summing to the price they came from — and a breakdown whose parts do
 * not add up is one nobody checks twice.
 */
export function instalmentShares(totalMinor: number, count: number): number[] {
  const n = Math.max(1, Math.trunc(count));
  const total = Math.round(totalMinor);
  const base = Math.trunc(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, index) =>
    index < Math.abs(remainder) ? base + Math.sign(remainder) : base,
  );
}

/** One monthly charge of a plan. */
export interface InstalmentCharge {
  /** 1-based, as it is spoken: "3/12". */
  index: number;
  count: number;
  date: LocalDate;
  amountMinor: number;
}

/** Every charge the purchase produces, first to last. */
export function instalmentCharges(entry: Transaction): InstalmentCharge[] {
  const count = instalmentCount(entry);
  const shares = instalmentShares(entry.amountMinor, count);
  const anchor = fromLocalDate(entry.date);
  return shares.map((amountMinor, index) => ({
    index: index + 1,
    count,
    // Measured from the purchase rather than from the previous charge, so a
    // purchase on the 31st is charged on the 28th in February and back on the
    // 31st in March — the same rule a monthly repeating entry follows.
    date: toLocalDate(addMonths(anchor, index)),
    amountMinor,
  }));
}

/**
 * The rows a purchase contributes to the ledger and to every total over it.
 *
 * An ordinary purchase is itself. A plan is its charges, each carrying the
 * purchase's own id — the row a view opens, deletes or edits is always the
 * purchase, never one twelfth of it.
 *
 * Idempotent: handed a row that is already a charge it returns it untouched,
 * so a list that passes through two aggregation functions is not split twice.
 */
export function chargeRows(entry: Transaction): Transaction[] {
  if (entry.instalmentIndex !== undefined) return [entry];
  if (!isInstalment(entry)) return [entry];
  return instalmentCharges(entry).map((charge) => ({
    ...entry,
    date: charge.date,
    amountMinor: charge.amountMinor,
    instalmentIndex: charge.index,
  }));
}

/** The same over a whole ledger. */
export function expandInstalments(transactions: Transaction[]): Transaction[] {
  return transactions.flatMap(chargeRows);
}

/**
 * What the plan has not charged yet as of `asOf`, in minor units.
 *
 * The debt the user is carrying, which is the number the month totals
 * deliberately do not show: this month's budget owes one instalment, but the
 * card owes all of them.
 */
export function outstandingMinor(entry: Transaction, asOf: LocalDate): number {
  if (!isInstalment(entry)) return 0;
  return instalmentCharges(entry)
    .filter((charge) => charge.date > asOf)
    .reduce((sum, charge) => sum + charge.amountMinor, 0);
}

/** How many charges are still to come after `asOf`. */
export function outstandingCount(entry: Transaction, asOf: LocalDate): number {
  if (!isInstalment(entry)) return 0;
  return instalmentCharges(entry).filter((charge) => charge.date > asOf).length;
}

/** The plans still being paid off, purchase order. */
export function openInstalmentPlans(
  transactions: Transaction[],
  asOf: LocalDate,
): Transaction[] {
  return transactions.filter(
    (entry) =>
      entry.deletedAt === null &&
      isInstalment(entry) &&
      outstandingMinor(entry, asOf) > 0,
  );
}
