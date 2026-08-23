import { describe, expect, it } from "vitest";
import {
  coveredWeekDates,
  extraDaysAvailability,
  extraDaysPatch,
  isExtraDaysRule,
  weekDatesOf,
} from "../extraDays";
import { expandOccurrences } from "../recurrence";
import type { Task } from "../types";

/** Tue 2026-08-25. Its Monday-first week is Aug 24 (Mon) .. Aug 30 (Sun). */
const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Prepare project presentation",
  description: "",
  status: "TODO",
  priority: "NONE",
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
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  completedAt: null,
  deletedAt: null,
  ...overrides,
});

/** Apply a patch the way the store does, then ask the calendar what it sees. */
const datesAfter = (source: Task, picked: string[], weekStartsOn: 0 | 1 = 1) => {
  const patch = extraDaysPatch(source, picked, weekStartsOn);
  const next = { ...source, ...patch };
  const week = weekDatesOf(next.dueDate, weekStartsOn);
  return expandOccurrences(next, week[0] as string, week[6] as string);
};

describe("the week a task belongs to", () => {
  it("runs Monday to Sunday when the week starts on Monday", () => {
    expect(weekDatesOf("2026-08-25", 1)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("runs Sunday to Saturday when the week starts on Sunday", () => {
    expect(weekDatesOf("2026-08-25", 0)[0]).toBe("2026-08-23");
    expect(weekDatesOf("2026-08-25", 0)[6]).toBe("2026-08-29");
  });
});

describe("adding a second day inside the week", () => {
  it("puts the task on both days, and only those days", () => {
    expect(datesAfter(task(), ["2026-08-25", "2026-08-27"])).toEqual([
      "2026-08-25",
      "2026-08-27",
    ]);
  });

  it("still holds when the extra day comes before the original one", () => {
    expect(datesAfter(task(), ["2026-08-24", "2026-08-25"])).toEqual([
      "2026-08-24",
      "2026-08-25",
    ]);
  });

  it("anchors the task on its first day", () => {
    const patch = extraDaysPatch(task(), ["2026-08-27", "2026-08-24"], 1);
    expect(patch.dueDate).toBe("2026-08-24");
    expect(patch.recurrence?.byWeekday).toEqual([1, 4]);
    expect(patch.recurrence?.until).toBe("2026-08-27");
  });

  it("reaches across the Saturday/Sunday boundary of a Monday-first week", () => {
    expect(datesAfter(task(), ["2026-08-25", "2026-08-30"])).toEqual([
      "2026-08-25",
      "2026-08-30",
    ]);
  });

  it("never spills into the following week", () => {
    const patch = extraDaysPatch(task(), ["2026-08-25", "2026-08-27"], 1);
    const next = { ...task(), ...patch };
    expect(expandOccurrences(next, "2026-08-24", "2026-09-30")).toEqual([
      "2026-08-25",
      "2026-08-27",
    ]);
  });

  it("takes all seven days", () => {
    expect(datesAfter(task(), weekDatesOf("2026-08-25", 1))).toHaveLength(7);
  });

  it("ignores days outside the task's own week", () => {
    expect(datesAfter(task(), ["2026-08-25", "2026-09-08"])).toEqual(["2026-08-25"]);
  });
});

describe("taking days back", () => {
  it("returns a plain one-day task, exactly as it started", () => {
    const original = task();
    const spread = { ...original, ...extraDaysPatch(original, ["2026-08-25", "2026-08-27"], 1) };
    const back = { ...spread, ...extraDaysPatch(spread, ["2026-08-25"], 1) };

    expect(back.recurrence).toBeNull();
    expect(back.dueDate).toBe(original.dueDate);
    expect(back.endDate).toBeNull();
    expect(expandOccurrences(back, "2026-08-01", "2026-12-31")).toEqual(["2026-08-25"]);
  });

  it("keeps the task on its day rather than unscheduling it when nothing is picked", () => {
    expect(extraDaysPatch(task(), [], 1).dueDate).toBe("2026-08-25");
  });
});

describe("which days the task already covers", () => {
  it("is just its own day for a plain task", () => {
    expect(coveredWeekDates(task(), 1)).toEqual(["2026-08-25"]);
  });

  it("reads back every day of a spread task", () => {
    const spread = { ...task(), ...extraDaysPatch(task(), ["2026-08-25", "2026-08-27"], 1) };
    expect(coveredWeekDates(spread, 1)).toEqual(["2026-08-25", "2026-08-27"]);
  });
});

describe("when the control may be offered", () => {
  it("is offered for an ordinary scheduled task", () => {
    expect(extraDaysAvailability(task(), 1)).toBe("ok");
  });

  it("is offered again for a task it has already spread", () => {
    const spread = { ...task(), ...extraDaysPatch(task(), ["2026-08-25", "2026-08-27"], 1) };
    expect(extraDaysAvailability(spread, 1)).toBe("ok");
  });

  it("is withheld from an unscheduled task", () => {
    expect(extraDaysAvailability(task({ dueDate: null }), 1)).toBe("unscheduled");
  });

  it("is withheld from a multi-day run", () => {
    expect(extraDaysAvailability(task({ endDate: "2026-08-28" }), 1)).toBe("spanning");
  });

  it("is withheld from a real repeat rule, which owns its own dates", () => {
    const weekly = task({
      recurrence: { freq: "WEEKLY", interval: 1, byWeekday: [2], until: null, count: null },
    });
    expect(extraDaysAvailability(weekly, 1)).toBe("series");
    expect(isExtraDaysRule(weekly, 1)).toBe(false);
  });

  it("is withheld from a weekly rule that outlives its own week", () => {
    const bounded = task({
      recurrence: {
        freq: "WEEKLY",
        interval: 1,
        byWeekday: [2, 4],
        until: "2026-10-01",
        count: null,
      },
    });
    expect(extraDaysAvailability(bounded, 1)).toBe("series");
  });
});
