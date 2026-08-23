import { describe, expect, it } from "vitest";
import { atTime } from "../datetime";
import { deadlineOf, effectiveStatus, toInstance } from "../task";
import type { Task } from "../types";

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

describe("effectiveStatus", () => {
  const deadline = atTime("2026-08-25", "16:00");

  it("keeps a new task in TODO before its deadline", () => {
    expect(effectiveStatus("TODO", deadline, null, atTime("2026-08-25", "10:00"))).toBe("TODO");
  });

  it("derives OVERDUE once the deadline passes", () => {
    expect(effectiveStatus("TODO", deadline, null, atTime("2026-08-26", "09:00"))).toBe("OVERDUE");
  });

  it("never reports a completed task as overdue", () => {
    expect(effectiveStatus("COMPLETED", deadline, null, atTime("2026-08-30", "09:00"))).toBe(
      "COMPLETED",
    );
  });

  it("reports SNOOZED instead of OVERDUE while the snooze holds (spec 5.4)", () => {
    const snoozedUntil = atTime("2026-08-27", "09:00").toISOString();
    const status = effectiveStatus("TODO", deadline, snoozedUntil, atTime("2026-08-26", "09:00"));
    expect(status).toBe("SNOOZED");
    expect(status).not.toBe("COMPLETED");
  });

  it("falls back to OVERDUE once the snooze expires", () => {
    const snoozedUntil = atTime("2026-08-26", "09:00").toISOString();
    expect(effectiveStatus("TODO", deadline, snoozedUntil, atTime("2026-08-27", "09:00"))).toBe(
      "OVERDUE",
    );
  });

  it("preserves IN_PROGRESS while the task is still on time", () => {
    expect(effectiveStatus("IN_PROGRESS", deadline, null, atTime("2026-08-25", "15:00"))).toBe(
      "IN_PROGRESS",
    );
  });
});

describe("deadlineOf", () => {
  it("uses the end time for a timed task", () => {
    expect(deadlineOf(task(), "2026-08-25")).toEqual(atTime("2026-08-25", "16:00"));
  });

  it("falls back to the start time when there is no end", () => {
    expect(deadlineOf(task({ endTime: null }), "2026-08-25")).toEqual(
      atTime("2026-08-25", "14:00"),
    );
  });

  it("gives an all-day task until the end of the day", () => {
    expect(deadlineOf(task({ allDay: true, startTime: null, endTime: null }), "2026-08-25")).toEqual(
      atTime("2026-08-25", "23:59"),
    );
  });

  it("has no deadline without a date", () => {
    expect(deadlineOf(task({ dueDate: null }), null)).toBeNull();
  });
});

describe("toInstance", () => {
  it("reads occurrence state for a recurring series, not the task row", () => {
    const series = task({
      recurrence: { freq: "DAILY", interval: 1 },
      status: "TODO",
    });
    const instance = toInstance(
      series,
      "2026-08-26",
      {
        id: "t1::2026-08-26",
        taskId: "t1",
        date: "2026-08-26",
        status: "COMPLETED",
        completedAt: "2026-08-26T10:00:00.000Z",
        snoozedUntil: null,
        updatedAt: "2026-08-26T10:00:00.000Z",
      },
      atTime("2026-08-26", "18:00"),
    );

    expect(instance.status).toBe("COMPLETED");
    expect(instance.key).toBe("t1::2026-08-26");
    // The next day is untouched by that completion.
    expect(toInstance(series, "2026-08-27", null, atTime("2026-08-27", "10:00")).status).toBe(
      "TODO",
    );
  });
});
