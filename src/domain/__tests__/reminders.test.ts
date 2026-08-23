import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/data/db";
import { atTime } from "../datetime";
import { collectDueReminders } from "../reminders";
import type { Occurrence, Reminder, Task } from "../types";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Prepare project presentation",
  description: "",
  status: "TODO",
  priority: "HIGH",
  dueDate: "2026-08-25",
  allDay: false,
  startTime: "14:00",
  endTime: "16:00",
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
});

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: "r1",
  taskId: "t1",
  kind: "RELATIVE",
  offsetMinutes: 10,
  remindAt: null,
  status: "PENDING",
  snoozedUntil: null,
  lastFiredFor: null,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
  ...overrides,
});

const collect = (t: Task, r: Reminder, now: Date, occurrences: Occurrence[] = []) =>
  collectDueReminders(
    [r],
    new Map([[t.id, t]]),
    new Map(occurrences.map((o) => [o.id, o])),
    DEFAULT_SETTINGS,
    now,
  );

describe("collectDueReminders", () => {
  it("stays silent before the reminder instant", () => {
    expect(collect(task(), reminder(), atTime("2026-08-25", "13:45"))).toHaveLength(0);
  });

  it("delivers once the offset is reached", () => {
    const due = collect(task(), reminder(), atTime("2026-08-25", "13:50"));
    expect(due).toHaveLength(1);
    expect(due[0]?.instance.date).toBe("2026-08-25");
  });

  it("does not deliver the same occurrence twice", () => {
    const fired = reminder({ status: "FIRED", lastFiredFor: "2026-08-25" });
    expect(collect(task(), fired, atTime("2026-08-25", "14:30"))).toHaveLength(0);
  });

  it("uses the all-day reminder time for an all-day task", () => {
    const allDay = task({ allDay: true, startTime: null, endTime: null });
    expect(collect(allDay, reminder(), atTime("2026-08-25", "08:45"))).toHaveLength(0);
    expect(collect(allDay, reminder(), atTime("2026-08-25", "08:50"))).toHaveLength(1);
  });

  it("stays silent for a completed task", () => {
    const done = task({ status: "COMPLETED" });
    expect(collect(done, reminder(), atTime("2026-08-25", "13:55"))).toHaveLength(0);
  });

  it("fires an absolute reminder on an undated task", () => {
    const undated = task({ dueDate: null, allDay: true, startTime: null, endTime: null });
    const absolute = reminder({
      kind: "ABSOLUTE",
      offsetMinutes: null,
      remindAt: atTime("2026-08-25", "09:00").toISOString(),
    });
    expect(collect(undated, absolute, atTime("2026-08-25", "08:59"))).toHaveLength(0);
    expect(collect(undated, absolute, atTime("2026-08-25", "09:01"))).toHaveLength(1);
  });
});
