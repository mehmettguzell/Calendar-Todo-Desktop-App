import { describe, expect, it } from "vitest";
import {
  cloudTaskFingerprint,
  localTaskFingerprint,
  serializeTaskForCloud,
} from "@/state/syncEngine";
import type { Task } from "@/domain/types";

const USER = "user-1";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Prepare project presentation",
    description: "",
    status: "TODO",
    priority: "HIGH",
    dueDate: "2026-08-25",
    endDate: null,
    allDay: false,
    startTime: "14:00",
    endTime: "16:00",
    categoryId: "cat-work",
    tags: [],
    parentId: null,
    recurrence: null,
    snoozedUntil: null,
    order: 0,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Simulates what PostgREST hands back for a row this engine just wrote:
 * absent keys come back missing, TIMESTAMPTZ columns come back in Postgres'
 * own spelling, and `tags` is never null.
 */
function readBackFromPostgres(row: Record<string, unknown>) {
  const stamp = (v: unknown) =>
    v == null ? null : new Date(v as string).toISOString().replace("Z", "+00:00");
  return {
    ...row,
    end_date: row.end_date ?? null,
    tags: row.tags ?? [],
    completed_at: stamp(row.completed_at),
    created_at: stamp(row.created_at),
    updated_at: stamp(row.updated_at),
  };
}

function roundTrip(t: Task) {
  return cloudTaskFingerprint(
    readBackFromPostgres(serializeTaskForCloud(t, USER)),
  );
}

describe("sync fingerprints", () => {
  it("treats a freshly uploaded task as already in sync", () => {
    const t = task();
    expect(roundTrip(t)).toBe(localTaskFingerprint(t));
  });

  it.each([
    ["empty description stored as NULL", task({ description: "" })],
    ["no due date", task({ dueDate: null, allDay: true })],
    ["no end date", task({ endDate: null })],
    [
      "completed_at as a TIMESTAMPTZ",
      task({ status: "COMPLETED", completedAt: "2026-08-25T13:05:07.412Z" }),
    ],
    ["tags present", task({ tags: ["deep-work", "q3"] })],
    [
      "recurrence round-tripped through JSONB",
      task({
        recurrence: { freq: "WEEKLY", interval: 2, byWeekday: [3, 1], until: null },
      }),
    ],
    ["soft deleted", task({ deletedAt: "2026-08-26T08:00:00.000Z" })],
  ])("reports no difference for %s", (_label, t) => {
    expect(roundTrip(t)).toBe(localTaskFingerprint(t));
  });

  it("still detects a real edit", () => {
    const before = task();
    const after = task({ title: "Prepare board presentation" });
    expect(roundTrip(before)).not.toBe(localTaskFingerprint(after));
  });

  it("detects a status change", () => {
    const before = task();
    const after = task({ status: "COMPLETED", completedAt: "2026-08-25T10:00:00.000Z" });
    expect(roundTrip(before)).not.toBe(localTaskFingerprint(after));
  });
});
