import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/data/db";
import { atTime } from "../datetime";
import { occurrenceId } from "../ids";
import { collectDueReminders, nextReminderInstant } from "../reminders";
import type { Occurrence, Reminder, Task } from "../types";

/**
 * The scheduler sleeps on this answer, so a wrong one is a reminder that never
 * arrives — the loudest possible bug. Every case here pairs "when do we wake?"
 * with "and is anything actually due then?", because the two have to agree.
 */
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

const next = (
  tasks: Task[],
  reminders: Reminder[],
  now: Date,
  occurrences: Occurrence[] = [],
) =>
  nextReminderInstant(
    reminders,
    new Map(tasks.map((t) => [t.id, t])),
    new Map(occurrences.map((o) => [o.id, o])),
    DEFAULT_SETTINGS,
    now,
  );

const due = (
  tasks: Task[],
  reminders: Reminder[],
  now: Date,
  occurrences: Occurrence[] = [],
) =>
  collectDueReminders(
    reminders,
    new Map(tasks.map((t) => [t.id, t])),
    new Map(occurrences.map((o) => [o.id, o])),
    DEFAULT_SETTINGS,
    now,
  );

describe("nextReminderInstant", () => {
  it("names the exact instant the reminder comes due", () => {
    const at = next([task()], [reminder()], atTime("2026-08-25", "09:00"));
    expect(at).toEqual(atTime("2026-08-25", "13:50"));
  });

  /** The whole point: sleeping until that instant must land on a delivery. */
  it("wakes at an instant where something really is due", () => {
    const t = task();
    const r = reminder();
    const at = next([t], [r], atTime("2026-08-25", "09:00"))!;
    expect(due([t], [r], at)).toHaveLength(1);
  });

  it("returns null when nothing is left to fire", () => {
    expect(next([task()], [], atTime("2026-08-25", "09:00"))).toBe(null);
    expect(
      next([task()], [reminder({ status: "DISMISSED" })], atTime("2026-08-25", "09:00")),
    ).toBe(null);
  });

  it("ignores an instant that has already gone by", () => {
    // 13:50 is behind us; a one-off reminder has no later instant to offer.
    expect(next([task()], [reminder()], atTime("2026-08-25", "13:55"))).toBe(null);
  });

  it("picks the soonest of several", () => {
    const early = task({ id: "t1", dueDate: "2026-08-25", startTime: "09:00" });
    const late = task({ id: "t2", dueDate: "2026-08-25", startTime: "17:00" });
    const at = next(
      [early, late],
      [reminder({ id: "r1", taskId: "t1" }), reminder({ id: "r2", taskId: "t2" })],
      atTime("2026-08-25", "07:00"),
    );
    expect(at).toEqual(atTime("2026-08-25", "08:50"));
  });

  it("stays silent for a task the user already completed", () => {
    const done = task({ status: "COMPLETED", completedAt: "2026-08-25T08:00:00.000Z" });
    expect(next([done], [reminder()], atTime("2026-08-25", "09:00"))).toBe(null);
  });

  /**
   * A series keeps its per-run state in an occurrence row, so ticking off
   * today has to move the wake-up to tomorrow rather than silence the series.
   */
  it("skips a completed run of a series and wakes for the next one", () => {
    const daily = task({ recurrence: { freq: "DAILY", interval: 1 } as Task["recurrence"] });
    const doneToday: Occurrence = {
      id: occurrenceId("t1", "2026-08-25"),
      taskId: "t1",
      date: "2026-08-25",
      status: "COMPLETED",
      completedAt: "2026-08-25T08:00:00.000Z",
      snoozedUntil: null,
      updatedAt: "2026-08-25T08:00:00.000Z",
    };
    const at = next([daily], [reminder()], atTime("2026-08-25", "09:00"), [doneToday]);
    expect(at).toEqual(atTime("2026-08-26", "13:50"));
  });

  it("looks past today to the next run of a repeating task", () => {
    const daily = task({ recurrence: { freq: "DAILY", interval: 1 } as Task["recurrence"] });
    const at = next([daily], [reminder()], atTime("2026-08-25", "15:00"));
    expect(at).toEqual(atTime("2026-08-26", "13:50"));
  });

  it("waits out a snooze rather than waking during it", () => {
    const at = next(
      [task()],
      [reminder({ snoozedUntil: "2026-08-25T12:00:00.000Z" })],
      atTime("2026-08-25", "09:00"),
    );
    // Still snoozed at the moment asked, so it offers nothing to wake for.
    expect(at).toBe(null);
  });
});
