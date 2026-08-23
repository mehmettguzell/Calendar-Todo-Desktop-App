import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/data/db";
import { atTime } from "../datetime";
import { reminderNotification } from "../notification";
import { collectDueReminders } from "../reminders";
import { toInstance } from "../task";
import type { Category, Reminder, Task } from "../types";

const presentation = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Project presentation",
  description: "",
  status: "TODO",
  priority: "HIGH",
  dueDate: "2026-08-25",
  endDate: null,
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

const work: Category = { id: "c1", name: "Work", color: "#3b82f6", order: 0 };

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: "r1",
  taskId: "t1",
  kind: "RELATIVE",
  offsetMinutes: 0,
  remindAt: null,
  status: "PENDING",
  snoozedUntil: null,
  lastFiredFor: null,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
  ...overrides,
});

describe("what a reminder banner says", () => {
  it("matches the shape the spec asks for: title, then when", () => {
    const now = atTime("2026-08-25", "14:00");
    const payload = reminderNotification(
      toInstance(presentation({ priority: "NONE" }), "2026-08-25", null, now),
      now,
    );

    expect(payload.title).toBe("Project presentation");
    expect(payload.body.startsWith("Today at 14:00")).toBe(true);
  });

  it("leaves the clock out of an all-day task", () => {
    const now = atTime("2026-08-25", "09:00");
    const allDay = presentation({
      allDay: true,
      startTime: null,
      endTime: null,
      priority: "NONE",
    });
    const payload = reminderNotification(
      toInstance(allDay, "2026-08-25", null, now),
      now,
    );

    expect(payload.body).toBe("Today");
  });

  it("leads with Overdue once the deadline has passed", () => {
    const now = atTime("2026-08-26", "09:00");
    const payload = reminderNotification(
      toInstance(presentation(), "2026-08-25", null, now),
      now,
    );

    expect(payload.body.startsWith("Overdue · ")).toBe(true);
  });

  it("names the run's last day for a multi-day task", () => {
    const now = atTime("2026-08-25", "09:00");
    const trip = presentation({
      endDate: "2026-08-28",
      allDay: true,
      startTime: null,
      endTime: null,
      priority: "NONE",
    });
    const payload = reminderNotification(
      toInstance(trip, "2026-08-25", null, now),
      now,
    );

    expect(payload.body).toContain("until 2026-08-28");
  });

  it("adds the category and a high-priority flag when there is one", () => {
    const now = atTime("2026-08-25", "14:00");
    const payload = reminderNotification(
      toInstance(presentation({ categoryId: "c1" }), "2026-08-25", null, now),
      now,
      work,
    );

    expect(payload.body).toContain("Work");
    expect(payload.body).toContain("High priority");
  });

  it("never produces an empty title", () => {
    const now = atTime("2026-08-25", "14:00");
    const payload = reminderNotification(
      toInstance(presentation({ title: "   " }), "2026-08-25", null, now),
      now,
    );

    expect(payload.title).toBe("Untitled task");
  });
});

describe("the reminder delivery pipeline", () => {
  const tasksOf = (...tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]));

  it("delivers a reminder whose moment has arrived", () => {
    const now = atTime("2026-08-25", "14:00");
    const due = collectDueReminders(
      [reminder()],
      tasksOf(presentation()),
      new Map(),
      DEFAULT_SETTINGS,
      now,
    );

    expect(due).toHaveLength(1);
    expect(reminderNotification(due[0]!.instance, now).title).toBe(
      "Project presentation",
    );
  });

  it("stays silent before the moment arrives", () => {
    const now = atTime("2026-08-25", "13:00");
    expect(
      collectDueReminders(
        [reminder()],
        tasksOf(presentation()),
        new Map(),
        DEFAULT_SETTINGS,
        now,
      ),
    ).toHaveLength(0);
  });

  it("stays silent once the task is completed — one row, one source of truth", () => {
    const now = atTime("2026-08-25", "14:00");
    const done = presentation({
      status: "COMPLETED",
      completedAt: "2026-08-25T10:00:00.000Z",
    });

    expect(
      collectDueReminders(
        [reminder()],
        tasksOf(done),
        new Map(),
        DEFAULT_SETTINGS,
        now,
      ),
    ).toHaveLength(0);
  });

  it("stays silent while the task is snoozed, and speaks up again after", () => {
    const now = atTime("2026-08-25", "14:00");
    const snoozed = presentation({ snoozedUntil: atTime("2026-08-25", "15:00").toISOString() });

    expect(
      collectDueReminders([reminder()], tasksOf(snoozed), new Map(), DEFAULT_SETTINGS, now),
    ).toHaveLength(0);

    const later = atTime("2026-08-25", "15:30");
    expect(
      collectDueReminders([reminder()], tasksOf(snoozed), new Map(), DEFAULT_SETTINGS, later),
    ).toHaveLength(1);
  });

  it("does not deliver the same non-recurring reminder twice", () => {
    const now = atTime("2026-08-25", "14:30");
    expect(
      collectDueReminders(
        [reminder({ status: "FIRED" })],
        tasksOf(presentation()),
        new Map(),
        DEFAULT_SETTINGS,
        now,
      ),
    ).toHaveLength(0);
  });

  it("never delivers for a task in the trash", () => {
    const now = atTime("2026-08-25", "14:00");
    const trashed = presentation({ deletedAt: "2026-08-24T10:00:00.000Z" });
    expect(
      collectDueReminders([reminder()], tasksOf(trashed), new Map(), DEFAULT_SETTINGS, now),
    ).toHaveLength(0);
  });
});
