// How far the last successful pull got, per table. Never persisted: a cursor
// that outlives the process can be wrong about a sync that never finished, and
// the cost is a silently missing row. A restart costs one full pass, buys certainty.

export interface PullCursor {
  userId: string;
  /** Max `updated_at` seen; re-fetched inclusively, re-applying a row is a no-op. */
  tasks: string | null;
  categories: string | null;
  /** Focus rows never change after insert, so `created_at` is the watermark. */
  focus: string | null;
}

/** Incremental reads are a saving, not a source of truth; a full pass repairs what they miss. */
export const FULL_PASS_INTERVAL_MS = 15 * 60_000;

let cursor: PullCursor | null = null;
let lastFullPassAt = 0;

export function getPullCursor(): PullCursor | null {
  return cursor;
}

export function setPullCursor(next: PullCursor | null): void {
  cursor = next;
}

export function getLastFullPassAt(): number {
  return lastFullPassAt;
}

export function markFullPassDone(at: number): void {
  lastFullPassAt = at;
}

/** Forget where the pull got to (account change, sign-out). */
export function resetPullState(): void {
  cursor = null;
  lastFullPassAt = 0;
}
