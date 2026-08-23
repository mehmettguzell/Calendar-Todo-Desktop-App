import { describe, expect, it } from "vitest";
import { atTime } from "../datetime";
import { expandOccurrences } from "../recurrence";
import { deadlineOf, instancesInRange, spanOf, toInstance } from "../task";
import type { Task } from "../types";

const conference = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Berlin conference",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  dueDate: "2026-08-25",
  endDate: "2026-08-28",
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

describe("a task with an end date occupies every day in between", () => {
  it("expands to one date per covered day", () => {
    expect(expandOccurrences(conference(), "2026-08-01", "2026-09-01")).toEqual([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
  });

  it("clips the run to the requested range", () => {
    expect(expandOccurrences(conference(), "2026-08-26", "2026-08-27")).toEqual([
      "2026-08-26",
      "2026-08-27",
    ]);
  });

  it("produces nothing when the range misses the run entirely", () => {
    expect(expandOccurrences(conference(), "2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("still produces a single date when the end date is absent or not later", () => {
    expect(expandOccurrences(conference({ endDate: null }), "2026-08-01", "2026-09-01")).toEqual([
      "2026-08-25",
    ]);
    expect(
      expandOccurrences(conference({ endDate: "2026-08-25" }), "2026-08-01", "2026-09-01"),
    ).toEqual(["2026-08-25"]);
  });

  it("leaves a recurring series on single-day occurrences", () => {
    // `recurrence.until` already bounds a series; letting each repeat span days
    // as well would give two controls authority over the same dates.
    const daily = conference({
      recurrence: { freq: "DAILY", interval: 1, until: "2026-08-27" },
    });
    expect(expandOccurrences(daily, "2026-08-25", "2026-08-27")).toEqual([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ]);
  });
});

describe("every day of the run is one task, not four", () => {
  it("gives each rendered day its own key while keeping one task id", () => {
    const now = atTime("2026-08-26", "10:00");
    const instances = instancesInRange(
      conference(),
      "2026-08-01",
      "2026-09-01",
      new Map(),
      now,
    );

    expect(new Set(instances.map((i) => i.key)).size).toBe(4);
    expect(new Set(instances.map((i) => i.task.id))).toEqual(new Set(["t1"]));
    // A span is not a recurrence: status still lives on the task row.
    expect(instances.every((i) => !i.isRecurring)).toBe(true);
  });

  it("marks where each day sits inside the run", () => {
    expect(spanOf(conference(), "2026-08-25")).toEqual({
      length: 4,
      index: 0,
      isStart: true,
      isEnd: false,
    });
    expect(spanOf(conference(), "2026-08-27")).toEqual({
      length: 4,
      index: 2,
      isStart: false,
      isEnd: false,
    });
    expect(spanOf(conference(), "2026-08-28")).toEqual({
      length: 4,
      index: 3,
      isStart: false,
      isEnd: true,
    });
  });

  it("reports a single-day task as a run of one", () => {
    expect(spanOf(conference({ endDate: null }), "2026-08-25")).toEqual({
      length: 1,
      index: 0,
      isStart: true,
      isEnd: true,
    });
  });
});

describe("a running multi-day task is not overdue on its opening days", () => {
  it("shares one deadline — the end of the last day — across every date", () => {
    const task = conference();
    expect(deadlineOf(task, "2026-08-25")).toEqual(atTime("2026-08-28", "23:59"));
    expect(deadlineOf(task, "2026-08-28")).toEqual(atTime("2026-08-28", "23:59"));
  });

  it("stays TODO mid-run and turns OVERDUE only after the last day", () => {
    const task = conference();
    const midRun = atTime("2026-08-26", "12:00");
    expect(toInstance(task, "2026-08-25", null, midRun).status).toBe("TODO");

    const after = atTime("2026-08-29", "09:00");
    expect(toInstance(task, "2026-08-25", null, after).status).toBe("OVERDUE");
  });

  it("uses the timed end on the closing day", () => {
    const timed = conference({ allDay: false, startTime: "09:00", endTime: "17:00" });
    expect(deadlineOf(timed, "2026-08-25")).toEqual(atTime("2026-08-28", "17:00"));
  });
});
