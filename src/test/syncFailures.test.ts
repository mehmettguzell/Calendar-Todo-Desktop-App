import { describe, expect, it } from "vitest";
import { classifySyncError, isRetryableSyncFailure } from "@/lib/errors";
import { acceptsRemoteTask } from "@/state/syncEngine";

/**
 * The retry budget and the badge both hang off this one classification, so it
 * is worth pinning to the shapes Supabase actually returns.
 */
describe("classifySyncError", () => {
  it("reads a PostgREST missing-column error as a schema problem", () => {
    const kind = classifySyncError({
      code: "PGRST204",
      message: "Could not find the 'estimate_minutes' column of 'tasks' in the schema cache",
    });
    expect(kind).toBe("schema");
    // Asking again cannot conjure the column: this one waits for a condition.
    expect(isRetryableSyncFailure(kind)).toBe(false);
  });

  it("reads an expired token as an account problem", () => {
    const kind = classifySyncError({ code: "PGRST301", message: "JWT expired" });
    expect(kind).toBe("auth");
    expect(isRetryableSyncFailure(kind)).toBe(false);
  });

  it("reads a dropped connection as worth retrying", () => {
    expect(classifySyncError(new TypeError("Failed to fetch"))).toBe("offline");
    expect(classifySyncError(new Error("task upsert timed out after 15s"))).toBe("timeout");
    expect(isRetryableSyncFailure("offline")).toBe(true);
    expect(isRetryableSyncFailure("timeout")).toBe(true);
  });

  it("reads a struggling backend as worth retrying", () => {
    expect(classifySyncError({ status: 503, message: "Service Unavailable" })).toBe("server");
    expect(classifySyncError({ status: 429, message: "Too Many Requests" })).toBe("server");
    expect(isRetryableSyncFailure("server")).toBe(true);
  });

  it("falls back to a retryable unknown rather than giving up early", () => {
    expect(classifySyncError(new Error("something odd"))).toBe("unknown");
    expect(isRetryableSyncFailure("unknown")).toBe(true);
  });
});

/**
 * The realtime channel echoes this device's own writes back at it. What the
 * app does with that echo is the difference between a Trash that stays empty
 * and one that refills itself.
 */
describe("acceptsRemoteTask", () => {
  const base = {
    remoteUpdatedAt: "2026-08-25T10:00:00.000Z",
    remoteDeleted: false,
    localUpdatedAt: "2026-08-25T09:00:00.000Z",
    tombstoned: false,
    queued: false,
  };

  it("takes an ordinary newer row from another device", () => {
    expect(acceptsRemoteTask(base)).toBe(true);
  });

  it("refuses the echo of a purge this device made", () => {
    // Emptying the Trash removed the row here and pushed is_deleted upward.
    expect(
      acceptsRemoteTask({
        ...base,
        remoteDeleted: true,
        localUpdatedAt: null,
        tombstoned: true,
      }),
    ).toBe(false);
  });

  it("refuses a trashed row this device does not have", () => {
    expect(
      acceptsRemoteTask({ ...base, remoteDeleted: true, localUpdatedAt: null }),
    ).toBe(false);
  });

  it("refuses an echo while a local write for that row is still queued", () => {
    expect(acceptsRemoteTask({ ...base, queued: true })).toBe(false);
  });

  it("refuses a row older than the copy sitting here", () => {
    expect(
      acceptsRemoteTask({ ...base, localUpdatedAt: "2026-08-25T11:00:00.000Z" }),
    ).toBe(false);
  });

  it("lets the cloud win a tie, so two devices converge", () => {
    expect(
      acceptsRemoteTask({ ...base, localUpdatedAt: base.remoteUpdatedAt }),
    ).toBe(true);
  });
});
