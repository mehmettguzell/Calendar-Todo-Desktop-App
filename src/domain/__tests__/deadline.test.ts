import { describe, expect, it } from "vitest";
import { deadlineOf, instancesInRange } from "../task";
import type { Occurrence, Task } from "../types";

/**
 * A deadline says when a task stops being on time; `endDate` says which days it
 * occupies. The whole point of keeping them apart is that a deadline three
 * weeks out is drawn once, not across twenty-two days.
 */
const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Sunum",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  dueDate: "2026-08-30",
  allDay: true,
  startTime: null,
  endTime: null,
  categoryId: null,
  tags: [],
  parentId: null,
  recurrence: null,
  snoozedUntil: null,
  order: 0,
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  completedAt: null,
  deletedAt: null,
  ...overrides,
});

const NO_OCCURRENCES = new Map<string, Occurrence>();
const NOW = new Date("2026-08-30T10:00:00");

const render = (t: Task, from: string, to: string) =>
  instancesInRange(t, from, to, NO_OCCURRENCES, NOW).map((i) => ({
    date: i.date,
    isDeadline: i.isDeadline,
  }));

describe("a deadline on the calendar", () => {
  it("is drawn once, on its own day, and leaves the days before it alone", () => {
    expect(render(task({ deadline: "2026-09-20" }), "2026-08-01", "2026-09-30")).toEqual([
      { date: "2026-08-30", isDeadline: false },
      { date: "2026-09-20", isDeadline: true },
    ]);
  });

  it("does not draw a task twice when the deadline is its own day", () => {
    expect(render(task({ deadline: "2026-08-30" }), "2026-08-01", "2026-09-30")).toEqual([
      { date: "2026-08-30", isDeadline: true },
    ]);
  });

  it("puts an undated task on the calendar for its deadline alone", () => {
    // This is what gives a plan — which never has a date — a place to appear.
    expect(render(task({ dueDate: null, deadline: "2026-09-20" }), "2026-08-01", "2026-09-30")).toEqual([
      { date: "2026-09-20", isDeadline: true },
    ]);
  });

  it("stays out of a range the deadline does not fall in", () => {
    expect(render(task({ deadline: "2026-12-01" }), "2026-08-01", "2026-09-30")).toEqual([
      { date: "2026-08-30", isDeadline: false },
    ]);
  });

  it("leaves a multi-day span drawn on every day it covers", () => {
    // The span is unchanged by any of this: a conference still occupies its days.
    expect(render(task({ dueDate: "2026-08-25", endDate: "2026-08-28" }), "2026-08-01", "2026-08-31")).toEqual([
      { date: "2026-08-25", isDeadline: false },
      { date: "2026-08-26", isDeadline: false },
      { date: "2026-08-27", isDeadline: false },
      { date: "2026-08-28", isDeadline: false },
    ]);
  });

  it("marks the last day of a span that also carries a deadline", () => {
    const dates = render(
      task({ dueDate: "2026-08-25", endDate: "2026-08-28", deadline: "2026-08-28" }),
      "2026-08-01",
      "2026-08-31",
    );
    expect(dates).toHaveLength(4);
    expect(dates.at(-1)).toEqual({ date: "2026-08-28", isDeadline: true });
  });

  it("is ignored on a recurring task, which bounds itself with `until`", () => {
    expect(
      render(
        task({ recurrence: { freq: "WEEKLY", interval: 1 }, deadline: "2026-09-20" }),
        "2026-09-14",
        "2026-09-21",
      ),
    ).toEqual([
      { date: "2026-09-20", isDeadline: false },
    ]);
  });
});

describe("a deadline and being on time", () => {
  it("makes a task overdue once its day is over", () => {
    const late = deadlineOf(task({ deadline: "2026-08-29" }), "2026-08-30");
    expect(late?.getTime()).toBeLessThan(NOW.getTime());
  });

  it("outranks the schedule rather than adding to it", () => {
    // Due today, but nothing has to be finished until September.
    const at = deadlineOf(task({ deadline: "2026-09-20" }), "2026-08-30");
    expect(at?.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("applies to a task with no date at all", () => {
    // Without this a plan could never be late, because it never has a date.
    expect(deadlineOf(task({ dueDate: null, deadline: "2026-08-29" }), null)).not.toBeNull();
    expect(deadlineOf(task({ dueDate: null }), null)).toBeNull();
  });
});
