// How long the write queue waits before it goes out. Pure arithmetic, split
// from the timer so it can be tested without a live connection.

/** Trailing delay: every new edit pushes the flush out, so none leaves mid-burst. */
export const FLUSH_DELAY_MS = 30_000;

/** Ceiling a continuous stream of edits cannot push past. */
export const FLUSH_MAX_WAIT_MS = 120_000;

// A live undo offer holds the queue until it lapses, collapsing an
// edit-then-undo pair into no request. The ceiling wins over both.
export function flushDelayMs(input: {
  now: number;
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
