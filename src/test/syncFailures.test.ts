import { describe, expect, it } from "vitest";
import { classifySyncError, isRetryableSyncFailure } from "@/lib/errors";
import { acceptsRemoteTask } from "@/state/syncEngine";
import { migrate } from "@/data/db";

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

/**
 * The regression these guard.
 *
 * A realtime `tasks` payload was delivered to the occurrence and reminder
 * handlers, whose cloud mappers coerce freely (`row.task_id as string`, `?? null`).
 * Instead of rejecting the foreign row they minted an occurrence with no
 * `taskId` and no `date`, plus a reminder with no `taskId` and a task's
 * `status`. Neither row is reachable locally — occurrences are addressed as
 * `${taskId}::${date}` — but both were pushed on every pass, where `task_id`
 * is NOT NULL. Postgres rejected the batch, the reconciliation threw, and sync
 * stayed broken for good: the user saw "sync could not finish" forever while
 * every other collection silently stopped syncing too.
 */
describe("migrate drops rows that name no task", () => {
  const soundOccurrence = {
    id: "t_a::2026-08-25",
    taskId: "t_a",
    date: "2026-08-25",
    status: "TODO",
    completedAt: null,
    snoozedUntil: null,
    updatedAt: "2026-08-25T00:00:00.000Z",
  };

  it("keeps addressable occurrences and discards the rest", () => {
    const db = migrate({
      version: 2,
      tasks: [],
      occurrences: [
        soundOccurrence,
        // Exactly the shape `occurrenceFromCloud` produces from a tasks row.
        {
          id: "t_a",
          status: "TODO",
          completedAt: null,
          snoozedUntil: "2026-08-25T06:00:00.000Z",
          updatedAt: "2026-08-26T00:15:25.701+00:00",
        },
      ],
    });

    expect(db.occurrences).toHaveLength(1);
    expect(db.occurrences[0]?.id).toBe("t_a::2026-08-25");
  });

  it("discards an occurrence that has a task but no date", () => {
    const db = migrate({
      version: 2,
      tasks: [],
      occurrences: [{ ...soundOccurrence, date: undefined }],
    });

    expect(db.occurrences).toEqual([]);
  });

  it("discards a reminder that names no task", () => {
    const db = migrate({
      version: 2,
      tasks: [],
      reminders: [
        {
          id: "r_1",
          taskId: "t_a",
          kind: "RELATIVE",
          offsetMinutes: 10,
          remindAt: null,
          status: "PENDING",
          snoozedUntil: null,
          lastFiredFor: null,
          createdAt: "2026-08-21T07:41:33.869Z",
          updatedAt: "2026-08-21T07:41:33.869Z",
        },
        // `reminderFromCloud` applied to a tasks row: no taskId, and `status`
        // carries the task's "TODO", which the reminders CHECK rejects too.
        {
          id: "t_a",
          kind: "RELATIVE",
          offsetMinutes: null,
          remindAt: null,
          status: "TODO",
          snoozedUntil: "2026-08-25T06:00:00.000Z",
          lastFiredFor: null,
          createdAt: "2026-08-21T07:41:33.869+00:00",
          updatedAt: "2026-08-26T00:15:25.701+00:00",
        },
      ],
    });

    expect(db.reminders).toHaveLength(1);
    expect(db.reminders[0]?.id).toBe("r_1");
  });
});
