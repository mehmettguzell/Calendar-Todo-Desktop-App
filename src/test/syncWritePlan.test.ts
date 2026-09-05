import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/types";
import { localTaskFingerprint, planTaskWrites } from "@/state/syncEngine";

/**
 * Adding something and then deleting it should cost the server nothing.
 *
 * It used to cost two requests: an upsert whose only content was
 * `is_deleted: true`, for a row the server had never been told about, and an
 * insert carrying that row's history — a description of what happened to a
 * task that, over there, never happened.
 *
 * These tests are the only way to see that, because the fix is the *absence*
 * of a request and you cannot watch for something that does not go out.
 */
function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `task ${id}`,
    description: "",
    status: "TODO",
    priority: "NONE",
    dueDate: null,
    endDate: null,
    allDay: true,
    startTime: null,
    endTime: null,
    categoryId: null,
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

const index = (...tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]));

describe("what a flush decides to send", () => {
  it("says nothing about a task created and trashed before it was ever written", () => {
    const trashed = task("t1", { deletedAt: "2026-08-20T09:01:00.000Z" });

    const plan = planTaskWrites({
      queued: ["t1"],
      deleted: [],
      taskById: index(trashed),
      synced: new Map(),
    });

    expect(plan.upsert).toEqual([]);
    expect(plan.markDeleted).toEqual([]);
    // Its history goes with it: the trail describes a row nothing over there
    // has.
    expect(plan.forget.has("t1")).toBe(true);
  });

  it("does still send the trashing of a task the cloud knows about", () => {
    const live = task("t1");
    const trashed = { ...live, deletedAt: "2026-08-20T09:01:00.000Z" };

    const plan = planTaskWrites({
      queued: ["t1"],
      deleted: [],
      taskById: index(trashed),
      synced: new Map([["t1", localTaskFingerprint(live)]]),
    });

    expect(plan.upsert).toEqual(["t1"]);
    expect(plan.forget.has("t1")).toBe(false);
  });

  it("skips a purge of a row that was never uploaded", () => {
    // A purge leaves nothing behind locally either, so the id resolves to
    // nothing — which is exactly the case the old code sent an UPDATE for.
    const plan = planTaskWrites({
      queued: [],
      deleted: ["gone"],
      taskById: index(),
      synced: new Map(),
    });

    expect(plan.markDeleted).toEqual([]);
    expect(plan.forget.has("gone")).toBe(true);
  });

  it("still sends a purge of a row that was uploaded", () => {
    const plan = planTaskWrites({
      queued: [],
      deleted: ["t1"],
      taskById: index(),
      synced: new Map([["t1", "whatever"]]),
    });

    expect(plan.markDeleted).toEqual(["t1"]);
  });

  it("writes nothing for a row that has not changed since it was written", () => {
    const unchanged = task("t1");
    const plan = planTaskWrites({
      queued: ["t1"],
      deleted: [],
      taskById: index(unchanged),
      synced: new Map([["t1", localTaskFingerprint(unchanged)]]),
    });

    expect(plan.upsert).toEqual([]);
  });

  it("writes a new task that is still alive", () => {
    const fresh = task("t1");
    const plan = planTaskWrites({
      queued: ["t1"],
      deleted: [],
      taskById: index(fresh),
      synced: new Map(),
    });

    expect(plan.upsert).toEqual(["t1"]);
    expect(plan.forget.size).toBe(0);
  });

  it("lets a restored task through, because it no longer looks trashed", () => {
    const restored = task("t1", { deletedAt: null });
    const plan = planTaskWrites({
      queued: ["t1"],
      deleted: [],
      taskById: index(restored),
      synced: new Map(),
    });

    expect(plan.upsert).toEqual(["t1"]);
  });
});
