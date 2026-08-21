import { describe, expect, it } from "vitest";
import { expandOccurrences, nextOccurrenceAfter, occursOn } from "../recurrence";
import type { Recurrence } from "../types";

const series = (recurrence: Recurrence | null, dueDate = "2026-08-25") => ({
  dueDate,
  recurrence,
});

describe("expandOccurrences", () => {
  it("returns a single date for a non-recurring task inside the range", () => {
    expect(expandOccurrences(series(null), "2026-08-01", "2026-08-31")).toEqual(["2026-08-25"]);
  });

  it("returns nothing when the task falls outside the range", () => {
    expect(expandOccurrences(series(null), "2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("expands a daily rule across the range", () => {
    const dates = expandOccurrences(
      series({ freq: "DAILY", interval: 1 }),
      "2026-08-25",
      "2026-08-28",
    );
    expect(dates).toEqual(["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
  });

  it("honours the interval", () => {
    const dates = expandOccurrences(
      series({ freq: "DAILY", interval: 3 }),
      "2026-08-25",
      "2026-09-03",
    );
    expect(dates).toEqual(["2026-08-25", "2026-08-28", "2026-08-31", "2026-09-03"]);
  });

  it("expands weekly rules on the chosen weekdays", () => {
    // 2026-08-25 is a Tuesday; ask for Monday (1) and Wednesday (3).
    const dates = expandOccurrences(
      series({ freq: "WEEKLY", interval: 1, byWeekday: [1, 3] }),
      "2026-08-25",
      "2026-09-07",
    );
    expect(dates).toEqual(["2026-08-26", "2026-08-31", "2026-09-02", "2026-09-07"]);
  });

  it("stops at the until date", () => {
    const dates = expandOccurrences(
      series({ freq: "DAILY", interval: 1, until: "2026-08-27" }),
      "2026-08-25",
      "2026-09-30",
    );
    expect(dates).toEqual(["2026-08-25", "2026-08-26", "2026-08-27"]);
  });

  it("stops after the requested count", () => {
    const dates = expandOccurrences(
      series({ freq: "WEEKLY", interval: 1, count: 3 }),
      "2026-08-25",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-08-25", "2026-09-01", "2026-09-08"]);
  });

  it("skips occurrences before the range start but keeps counting them", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1 }),
      "2026-10-01",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-10-25", "2026-11-25", "2026-12-25"]);
  });

  it("produces nothing for an unscheduled task", () => {
    expect(expandOccurrences({ dueDate: null, recurrence: null }, "2026-01-01", "2026-12-31")).toEqual(
      [],
    );
  });
});

describe("nextOccurrenceAfter", () => {
  it("finds the next date in a series", () => {
    expect(nextOccurrenceAfter(series({ freq: "WEEKLY", interval: 1 }), "2026-08-25")).toBe(
      "2026-09-01",
    );
  });

  it("returns null once the series has ended", () => {
    expect(
      nextOccurrenceAfter(series({ freq: "DAILY", interval: 1, until: "2026-08-26" }), "2026-08-26"),
    ).toBeNull();
  });

  it("returns null for a one-off task already in the past", () => {
    expect(nextOccurrenceAfter(series(null), "2026-08-25")).toBeNull();
  });
});

describe("occursOn", () => {
  it("answers for a single date without expanding the whole range", () => {
    const yearly = series({ freq: "YEARLY", interval: 1 });
    expect(occursOn(yearly, "2027-08-25")).toBe(true);
    expect(occursOn(yearly, "2027-08-26")).toBe(false);
  });
});
