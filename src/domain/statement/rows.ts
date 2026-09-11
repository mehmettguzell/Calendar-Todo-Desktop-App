import type { MoneyFlow } from "../money";
import type { LocalDate } from "../types";

// What one parsed statement row looks like, and what a whole parse returns.

export interface StatementLine {
  date: LocalDate;
  /** The descriptor exactly as the bank wrote it. */
  description: string;
  /** Always positive; direction lives in `flow`. */
  amountMinor: number;
  flow: MoneyFlow;
  /**
   * What kind of movement this is.
   *
   * A credit card statement is not a list of purchases: it also contains the
   * payment that cleared last month's balance, the annual fee, and the refund
   * for the shoes that did not fit. Counting a card payment as spending
   * double-counts every purchase it paid for, which is the single easiest way
   * to make a budget lie.
   */
  kind: "spend" | "refund" | "payment" | "fee" | "interest" | "cash";
  /** Position in the file, so two identical rows stay two rows. */
  index: number;
  raw: string;
}

export interface SkippedRow {
  raw: string;
  reason: "no-date" | "no-amount" | "summary" | "empty";
}

export type StatementSource = "card" | "account";

export interface ParseResult {
  lines: StatementLine[];
  skipped: SkippedRow[];
  container: "html" | "delimited" | "text";
  /** How the sign of an amount was read. See `detectSource`. */
  source: StatementSource;
  /** Which columns were understood, when the file had a header. */
  columns: DetectedColumns | null;
  /** The header row as the bank wrote it, for the preview to show. */
  header: string[] | null;
}

export interface DetectedColumns {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

/* ------------------------------------------------------------------ */
/* Numbers and dates                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Row classification                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Header detection                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Containers                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Direction                                                            */
/* ------------------------------------------------------------------ */

/**
 * Whether a positive number means money out or money in.
 *
 * The two kinds of statement disagree, and getting it backwards turns a month
 * of spending into a month of income:
 *
 *   - a **card** statement lists purchases as positive and the payment that
 *     cleared them as negative;
 *   - an **account** statement lists money leaving as negative.
 *
 * A balance column only ever appears on an account statement, and a card
 * statement is overwhelmingly positive. Both signals are cheap and neither is
 * ever wrong on its own, so the caller can still override.
 */
