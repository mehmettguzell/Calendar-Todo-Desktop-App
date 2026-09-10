import { isRetryableSyncFailure, type SyncFailureKind } from "@/lib/errors";
import { isOnline, useSyncStore } from "@/state/syncStore";

// A few automatic attempts with doubling backoff, then quiet until a condition
// revives it (network back, window focused, button, cooldown lapsed). A
// signed-out session or a missing column fails the same on attempt 1 and 400.

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
const MAX_AUTO_RETRIES = 4;
const RETRY_COOLDOWN_MS = 10 * 60_000;

interface RetryDeps {
  currentUserId(): string | null;
  requestSync(): void;
}

let deps: RetryDeps = { currentUserId: () => null, requestSync: () => {} };

export function configureRetry(next: RetryDeps): void {
  deps = next;
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 0;
let retryAttempt = 0;
let retryPausedUntil = 0;

function publishRetryState(): void {
  useSyncStore.getState().setRetry(retryAttempt, retryPausedUntil > 0);
}

/** Stop automatic attempts until a condition revives them. */
function pauseRetries(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryPausedUntil = Date.now() + RETRY_COOLDOWN_MS;
  publishRetryState();
}

export function scheduleRetry(kind: SyncFailureKind): void {
  if (retryTimer || !deps.currentUserId()) return;

  // A schema mismatch or rejected token does not improve by asking again soon.
  if (!isRetryableSyncFailure(kind) || retryAttempt >= MAX_AUTO_RETRIES) {
    pauseRetries();
    return;
  }

  retryAttempt += 1;
  retryDelayMs =
    retryDelayMs === 0 ? RETRY_BASE_MS : Math.min(retryDelayMs * 2, RETRY_MAX_MS);
  publishRetryState();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (deps.currentUserId() && isOnline()) deps.requestSync();
  }, retryDelayMs);
}

/** May sync touch the network now? False only while a spent budget cools down. */
export function retriesAllowed(): boolean {
  if (retryPausedUntil === 0) return true;
  if (Date.now() >= retryPausedUntil) {
    resetRetryBudget();
    return true;
  }
  return false;
}

/** Clean slate: no pending attempt, no cooldown, a full budget. */
export function resetRetryBudget(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryDelayMs = 0;
  retryAttempt = 0;
  retryPausedUntil = 0;
  publishRetryState();
}
