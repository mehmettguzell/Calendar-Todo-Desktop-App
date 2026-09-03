import type { Transaction } from "./money";
import type { Instant, LocalDate } from "./types";

/**
 * One import of one statement, kept so it can be taken back later.
 *
 * The undo toast already reverses an import perfectly — but it lives for a few
 * seconds, and the mistake this guards against is not noticed in a few seconds.
 * Importing the same file twice looks fine until the month's total is read a
 * day later, and by then the only remedy is deleting a hundred rows by hand.
 *
 * So the import itself becomes a record. The entries it created point back at
 * it by `importId`; the entries it merely *stamped* are remembered here, in
 * `settled`, because those rows existed before it and undoing has to put them
 * back rather than take them away. Between the two, "geri al" is exact — and
 * still available next week.
 */
export interface StatementBatch {
  id: string;
  /** What the user recognises it by: the file, the card, the period. */
  label: string;
  /** The card or account, when the import named one. */
  account: string | null;
  importedAt: Instant;
  /** The span the rows covered, which is what groups these by month. */
  from: LocalDate;
  to: LocalDate;
  /** How the rows were turned into entries. See `ImportMode`. */
  mode: ImportMode;
  /** Entries this import added. Their own `importId` is the durable link. */
  createdCount: number;
  /** What the entries it created come to, in minor units. */
  createdMinor: number;
  /** Entries that already existed and were confirmed rather than repeated. */
  settled: SettledSnapshot[];
  /** When it was rolled back, or `null` while it still stands. */
  revertedAt: Instant | null;
  deletedAt: Instant | null;
}

/**
 * How a statement's rows become ledger entries.
 *
 * `rows` files every purchase the bank printed, which is what someone who does
 * not log spending by hand wants. `daily` files only the difference between
 * what the bank charged that day and what the user already wrote down, which is
 * what someone who *does* log by hand wants — see `dailyShortfalls`.
 */
export type ImportMode = "rows" | "daily";

/**
 * Enough of a settled entry to put it back exactly as it was.
 *
 * Only the fields a settle writes. Storing the whole row would mean an undo
 * also reverting edits the user made afterwards, which is not what they asked
 * to undo.
 */
export interface SettledSnapshot {
  id: string;
  externalId: string | null;
  confirmedAt: Instant | null;
  merchant: string | null;
  account: string | null;
  categoryId: string | null;
  amountMinor: number;
  date: LocalDate;
  origin: Transaction["origin"];
}

export function snapshotOf(entry: Transaction): SettledSnapshot {
  return {
    id: entry.id,
    externalId: entry.externalId ?? null,
    confirmedAt: entry.confirmedAt ?? null,
    merchant: entry.merchant ?? null,
    account: entry.account ?? null,
    categoryId: entry.categoryId,
    amountMinor: entry.amountMinor,
    date: entry.date,
    origin: entry.origin,
  };
}

/** The fields a snapshot puts back, as a patch. */
export function restorePatch(snap: SettledSnapshot): Partial<Transaction> {
  return {
    externalId: snap.externalId,
    confirmedAt: snap.confirmedAt,
    merchant: snap.merchant,
    account: snap.account,
    categoryId: snap.categoryId,
    amountMinor: snap.amountMinor,
    date: snap.date,
    origin: snap.origin,
  };
}

/** Still standing: not rolled back, not removed. */
export function isLive(batch: StatementBatch): boolean {
  return batch.deletedAt === null && batch.revertedAt === null;
}

/* ------------------------------------------------------------------ */
/* Daily top-up                                                        */
/* ------------------------------------------------------------------ */

/** One day the statement says more was spent than the ledger already knows. */
export interface DailyShortfall {
  date: LocalDate;
  /** What the bank charged that day. */
  statementMinor: number;
  /** What the ledger already held for that day, before this import. */
  recordedMinor: number;
  /** The difference, always > 0. This is what gets written. */
  shortfallMinor: number;
  /** How many statement rows that day's figure came from. */
  rowCount: number;
}

/**
 * A day is only topped up when the gap is worth a row.
 *
 * Below this the difference is bank rounding or a kuruş the user did not bother
 * with, and a ledger full of 0,03 ₺ entries is a ledger nobody reads. One lira.
 */
export const MIN_SHORTFALL_MINOR = 100;

/**
 * What each day of a statement is short by, against what is already recorded.
 *
 * This is the whole of the "I write down what I ate, but I forget things" case.
 * Matching row against row cannot serve it: the user did not write down the
 * bank's rows, they wrote down a rough memory of the day — 250 for a basket
 * that came to 253,40, two of four coffees, nothing at all on the busy days. No
 * pairing of those to individual purchases is right, and every one of them is
 * wrong in the same direction.
 *
 * The day's *total*, though, is not a guess: the bank knows exactly what it
 * charged, and the ledger knows exactly what was written down. The difference
 * between the two is the forgotten spending, whatever shape it had. So one
 * entry per day carries it, and nothing already in the ledger is touched.
 *
 * Deliberately one-directional. A day where the ledger holds *more* than the
 * statement is not corrected downwards: cash exists, the statement is only the
 * card, and quietly deleting what someone typed to make a total agree is the
 * one thing a ledger must never do.
 */
export function dailyShortfalls(
  statementRows: { date: LocalDate; amountMinor: number; flow: Transaction["flow"] }[],
  recorded: Transaction[],
  minShortfallMinor: number = MIN_SHORTFALL_MINOR,
): DailyShortfall[] {
  const statement = new Map<LocalDate, { minor: number; rows: number }>();
  for (const row of statementRows) {
    if (row.flow !== "EXPENSE") continue;
    const cell = statement.get(row.date) ?? { minor: 0, rows: 0 };
    cell.minor += row.amountMinor;
    cell.rows += 1;
    statement.set(row.date, cell);
  }

  const ledger = new Map<LocalDate, number>();
  for (const entry of recorded) {
    if (entry.deletedAt !== null || entry.flow !== "EXPENSE") continue;
    ledger.set(entry.date, (ledger.get(entry.date) ?? 0) + entry.amountMinor);
  }

  const out: DailyShortfall[] = [];
  for (const [date, cell] of statement) {
    const recordedMinor = ledger.get(date) ?? 0;
    const shortfallMinor = cell.minor - recordedMinor;
    if (shortfallMinor < minShortfallMinor) continue;
    out.push({
      date,
      statementMinor: cell.minor,
      recordedMinor,
      shortfallMinor,
      rowCount: cell.rows,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The identity of a day's top-up.
 *
 * Shaped like a statement row's `externalId` so the same guard stops a second
 * import of the same file topping the same day up twice. The recorded figure is
 * part of it on purpose: importing a fuller statement later, after more has been
 * written down by hand, is a genuinely different correction and should be
 * allowed to land.
 */
export function shortfallExternalId(day: DailyShortfall): string {
  return `stmt-daily:${day.date}:${day.statementMinor}:${day.recordedMinor}`;
}
