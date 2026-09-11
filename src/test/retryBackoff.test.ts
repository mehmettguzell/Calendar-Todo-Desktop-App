import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureRetry,
  resetRetryBudget,
  retriesAllowed,
  scheduleRetry,
} from "@/sync";
import { useSyncStore } from "@/state/syncStore";
import { wireSyncPorts } from "@/state/syncWiring";

/**
 * The retry budget: a few automatic attempts on a retryable failure, then quiet
 * until a condition revives it. Characterised here before the sync core is
 * carved up around it.
 */

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
const RETRY_COOLDOWN_MS = 10 * 60_000;

let requestSync: ReturnType<typeof vi.fn>;

// The retry budget reports through the status port, which the app installs.
wireSyncPorts();

beforeEach(() => {
  vi.useFakeTimers();
  requestSync = vi.fn();
  configureRetry({ currentUserId: () => "user-1", requestSync });
  // navigator.onLine defaults to true in jsdom; the timer needs it.
  resetRetryBudget();
});

afterEach(() => {
  resetRetryBudget();
  configureRetry({ currentUserId: () => null, requestSync: () => {} });
  vi.useRealTimers();
});

describe("automatic retries", () => {
  it("fires the first retry after the base delay", () => {
    scheduleRetry("offline");
    vi.advanceTimersByTime(RETRY_BASE_MS - 1);
    expect(requestSync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestSync).toHaveBeenCalledTimes(1);
  });

  it("doubles the delay each attempt up to the cap", () => {
    const firedAfter = (ms: number) => {
      const before = requestSync.mock.calls.length;
      vi.advanceTimersByTime(ms - 1);
      const early = requestSync.mock.calls.length === before;
      vi.advanceTimersByTime(1);
      return early && requestSync.mock.calls.length === before + 1;
    };

    scheduleRetry("offline");
    expect(firedAfter(5_000)).toBe(true);
    scheduleRetry("offline");
    expect(firedAfter(10_000)).toBe(true);
    scheduleRetry("offline");
    expect(firedAfter(20_000)).toBe(true);
    scheduleRetry("offline");
    expect(firedAfter(40_000)).toBe(true);
  });

  it("stops after the budget is spent and reports the pause", () => {
    for (let i = 0; i < 6; i += 1) {
      scheduleRetry("offline");
      vi.advanceTimersByTime(RETRY_MAX_MS);
    }
    expect(useSyncStore.getState().autoRetryPaused).toBe(true);
  });

  it("does not retry a non-retryable failure — it pauses straight away", () => {
    scheduleRetry("schema");
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(requestSync).not.toHaveBeenCalled();
    expect(useSyncStore.getState().autoRetryPaused).toBe(true);
  });
});

describe("retriesAllowed", () => {
  it("is true with a fresh budget", () => {
    expect(retriesAllowed()).toBe(true);
  });

  it("is false while a spent budget is cooling down", () => {
    scheduleRetry("schema"); // pauses immediately
    expect(retriesAllowed()).toBe(false);
  });

  it("grants one fresh budget once the cooldown lapses", () => {
    scheduleRetry("schema");
    expect(retriesAllowed()).toBe(false);
    vi.advanceTimersByTime(RETRY_COOLDOWN_MS + 1);
    expect(retriesAllowed()).toBe(true);
    // And the budget really was reset — the badge clears.
    expect(useSyncStore.getState().autoRetryPaused).toBe(false);
  });
});

describe("resetRetryBudget", () => {
  it("cancels a pending retry", () => {
    scheduleRetry("offline");
    resetRetryBudget();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(requestSync).not.toHaveBeenCalled();
  });
});
