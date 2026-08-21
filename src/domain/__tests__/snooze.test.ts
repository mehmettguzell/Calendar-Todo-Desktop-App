import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/data/db";
import { atTime, toLocalDate, toLocalTime } from "../datetime";
import { resolveSnooze } from "../snooze";
import { toInstance } from "../task";
import type { Task } from "../types";

const presentation = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Project presentation",
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

const instanceOf = (task: Task, now: Date) => toInstance(task, task.dueDate, null, now);

describe("resolveSnooze", () => {
  it("moves the task to tomorrow at the same time (spec 8)", () => {
    const now = atTime("2026-08-25", "14:00");
    const outcome = resolveSnooze(
      instanceOf(presentation(), now),
      "tomorrow",
      DEFAULT_SETTINGS,
      now,
    );

    expect(outcome.reschedule).toEqual({ date: "2026-08-26", startTime: "14:00" });
    expect(toLocalDate(new Date(outcome.until))).toBe("2026-08-26");
    expect(toLocalTime(new Date(outcome.until))).toBe("14:00");
  });

  it("postpones the reminder only when the snooze stays inside the day", () => {
    const now = atTime("2026-08-25", "14:00");
    const outcome = resolveSnooze(instanceOf(presentation(), now), "1h", DEFAULT_SETTINGS, now);

    // Snooze is not a reschedule: the task keeps its date.
    expect(outcome.reschedule).toBeNull();
    expect(toLocalTime(new Date(outcome.until))).toBe("15:00");
  });

  it("also moves the task when a short snooze crosses midnight", () => {
    const now = atTime("2026-08-25", "23:40");
    const outcome = resolveSnooze(instanceOf(presentation(), now), "30m", DEFAULT_SETTINGS, now);

    expect(outcome.reschedule?.date).toBe("2026-08-26");
  });

  it("jumps to the following Monday, preserving the time", () => {
    const now = atTime("2026-08-25", "14:00"); // Tuesday
    const outcome = resolveSnooze(instanceOf(presentation(), now), "monday", DEFAULT_SETTINGS, now);

    expect(outcome.reschedule?.date).toBe("2026-08-31");
    expect(toLocalTime(new Date(outcome.until))).toBe("14:00");
  });

  it("gives an all-day task the configured clock time", () => {
    const now = atTime("2026-08-25", "08:00");
    const allDay = presentation({ allDay: true, startTime: null, endTime: null });
    const outcome = resolveSnooze(instanceOf(allDay, now), "tomorrow", DEFAULT_SETTINGS, now);

    expect(outcome.reschedule).toEqual({ date: "2026-08-26", startTime: null });
    expect(toLocalTime(new Date(outcome.until))).toBe(DEFAULT_SETTINGS.allDayReminderTime);
  });

  it("moves an overdue task forward from today, not from its stale date", () => {
    const now = atTime("2026-08-28", "10:00");
    const outcome = resolveSnooze(
      instanceOf(presentation(), now),
      "tomorrow",
      DEFAULT_SETTINGS,
      now,
    );

    expect(outcome.reschedule?.date).toBe("2026-08-29");
  });

  it("honours a custom target", () => {
    const now = atTime("2026-08-25", "14:00");
    const outcome = resolveSnooze(
      instanceOf(presentation(), now),
      "custom",
      DEFAULT_SETTINGS,
      now,
      atTime("2026-09-01", "08:30"),
    );

    expect(outcome.reschedule?.date).toBe("2026-09-01");
    expect(toLocalTime(new Date(outcome.until))).toBe("08:30");
  });
});

describe("resolveSnooze on a recurring series", () => {
  it("postpones the occurrence without moving the series anchor", () => {
    const now = atTime("2026-08-25", "14:00");
    const daily = presentation({ recurrence: { freq: "DAILY", interval: 1 } });
    const instance = toInstance(daily, "2026-08-25", null, now);

    const outcome = resolveSnooze(instance, "tomorrow", DEFAULT_SETTINGS, now);

    // The reminder waits until tomorrow, but the rule still starts on the 25th.
    expect(outcome.reschedule).toBeNull();
    expect(toLocalDate(new Date(outcome.until))).toBe("2026-08-26");
  });
});
