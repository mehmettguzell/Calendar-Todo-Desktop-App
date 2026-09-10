/**
 * How long the write queue waits before it goes out.
 *
 * Pure arithmetic on three numbers, split from the timer that consumes it
 * because a pacing rule that can only be exercised by holding a real Supabase
 * connection open for eight seconds is a rule nobody tests.
 */

/**
 * The trailing delay: every new change pushes the flush out again, so a request
 * never leaves mid-burst. Measured against a real document — the curve of
 * requests-vs-window has flattened by 30s, and past there a longer window buys
 * single-digit savings for minutes of lag.
 */
export const FLUSH_DELAY_MS = 30_000;

/**
 * The ceiling a continuous stream of edits cannot push past. Four times the
 * window: a ceiling equal to the window would fire on every burst and there
 * would be no window.
 */
export const FLUSH_MAX_WAIT_MS = 120_000;

/**
 * Three rules, in order of who wins:
 *
 * 1. The trailing delay (above).
 * 2. A live undo offer holds the queue: waiting for the offer to lapse
 *    collapses a change-then-undo pair into no request at all. The gathering
 *    window now outlasts the toast on its own, so this rule currently never
 *    binds; it stays because the two numbers move for unrelated reasons.
 * 3. The ceiling wins over both.
 */
export function flushDelayMs(input: {
  now: number;
  /** When the oldest un-flushed change was queued. */
  queuedSince: number;
  /** When the standing undo offer lapses, or null if none stands. */
  undoOfferExpiresAt: number | null;
}): number {
  const { now, queuedSince, undoOfferExpiresAt } = input;
  const undoHold = undoOfferExpiresAt === null ? 0 : undoOfferExpiresAt - now;
  const wait = Math.max(FLUSH_DELAY_MS, undoHold);
  const remainingCap = FLUSH_MAX_WAIT_MS - (now - queuedSince);
  return Math.max(0, Math.min(wait, remainingCap));
}
