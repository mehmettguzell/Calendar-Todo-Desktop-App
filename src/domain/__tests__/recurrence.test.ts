import { describe, expect, it } from "vitest";
import { describeRecurrence, expandOccurrences, monthlyModeOf, monthlyRuleFor, nextOccurrenceAfter, occursOn, weekdayPositionInMonth, type Translate } from "../recurrence";
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

describe("describeRecurrence", () => {
  /*
   * Records which key was asked for and with what, rather than the finished
   * sentence: the wording lives in the dictionary and is free to change, but
   * which day a monthly rule claims to land on is a domain decision.
   */
  const trace: Translate = (key, params) =>
    params ? `${key}(${JSON.stringify(params)})` : key;

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  it("names the day of the month a monthly rule repeats on", () => {
    const out = describeRecurrence({ freq: "MONTHLY", interval: 1 }, trace, weekdays, "2026-08-25");
    expect(out).toContain("repeatOnMonthDay");
    expect(out).toContain('"day":25');
  });

  it("warns that days past the 28th fall back in shorter months", () => {
    const out = describeRecurrence({ freq: "MONTHLY", interval: 1 }, trace, weekdays, "2026-01-31");
    expect(out).toContain("repeatOnMonthDayShort");
    expect(out).toContain('"day":31');
  });

  it("stays silent about the day when the task has no date yet", () => {
    const out = describeRecurrence({ freq: "MONTHLY", interval: 1 }, trace, weekdays, null);
    expect(out).toBe("repeatEveryMonth");
  });

  it("leaves the other frequencies untouched", () => {
    expect(
      describeRecurrence({ freq: "DAILY", interval: 1 }, trace, weekdays, "2026-01-31"),
    ).toBe("repeatEveryDay");
    expect(
      describeRecurrence({ freq: "YEARLY", interval: 1 }, trace, weekdays, "2026-01-31"),
    ).toBe("repeatEveryYear");
  });
});

describe("monthly rules that name their own day", () => {
  it("lands on the last day of every month, however long the month is", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1, byMonthDay: -1 }, "2026-01-15"),
      "2026-01-01",
      "2026-04-30",
    );
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("finds February 29 in a leap year", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1, byMonthDay: -1 }, "2028-02-01"),
      "2028-02-01",
      "2028-02-29",
    );
    expect(dates).toEqual(["2028-02-29"]);
  });

  it("lands on the third Tuesday of every month", () => {
    const dates = expandOccurrences(
      // 2026-01-20 is the third Tuesday of January.
      series({ freq: "MONTHLY", interval: 1, bySetPos: 3, byWeekday: [2] }, "2026-01-20"),
      "2026-01-01",
      "2026-03-31",
    );
    expect(dates).toEqual(["2026-01-20", "2026-02-17", "2026-03-17"]);
  });

  it("lands on the last Friday of every month", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1, bySetPos: -1, byWeekday: [5] }, "2026-01-01"),
      "2026-01-01",
      "2026-03-31",
    );
    expect(dates).toEqual(["2026-01-30", "2026-02-27", "2026-03-27"]);
  });

  it("never starts a series before its own anchor", () => {
    // The first Monday of January is the 5th, but the task is dated the 20th.
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1, bySetPos: 1, byWeekday: [1] }, "2026-01-20"),
      "2026-01-01",
      "2026-03-31",
    );
    expect(dates).toEqual(["2026-02-02", "2026-03-02"]);
  });

  it("honours the interval", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 3, byMonthDay: -1 }, "2026-01-01"),
      "2026-01-01",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
  });

  it("counts occurrences, not months walked, when `count` is set", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1, byMonthDay: -1, count: 2 }, "2026-01-01"),
      "2026-01-01",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("leaves a rule with no monthly fields on the anchor's day", () => {
    const dates = expandOccurrences(
      series({ freq: "MONTHLY", interval: 1 }, "2026-01-31"),
      "2026-01-01",
      "2026-03-31",
    );
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("reports the next occurrence of a weekday rule", () => {
    expect(
      nextOccurrenceAfter(
        series({ freq: "MONTHLY", interval: 1, bySetPos: -1, byWeekday: [5] }, "2026-01-01"),
        "2026-01-30",
      ),
    ).toBe("2026-02-27");
  });
});

describe("monthlyRuleFor", () => {
  it("reads the weekday and its position off the anchor", () => {
    // 2026-01-20 is the third Tuesday of January.
    expect(monthlyRuleFor("NTH_WEEKDAY", "2026-01-20")).toEqual({
      byMonthDay: null,
      bySetPos: 3,
      byWeekday: [2],
    });
  });

  it("calls a fifth-week date the last one, since most months have no fifth", () => {
    expect(weekdayPositionInMonth("2026-01-29")).toBe(-1);
    expect(weekdayPositionInMonth("2026-01-28")).toBe(4);
  });

  it("clears the fields of the mode it is replacing", () => {
    expect(monthlyRuleFor("LAST_DAY", "2026-01-20")).toEqual({
      byMonthDay: -1,
      bySetPos: null,
      byWeekday: [],
    });
    expect(monthlyRuleFor("DAY_OF_MONTH", "2026-01-20")).toEqual({
      byMonthDay: null,
      bySetPos: null,
      byWeekday: [],
    });
  });

  it("round-trips through monthlyModeOf", () => {
    for (const mode of ["DAY_OF_MONTH", "LAST_DAY", "NTH_WEEKDAY"] as const) {
      const rule = { freq: "MONTHLY" as const, interval: 1, ...monthlyRuleFor(mode, "2026-01-20") };
      expect(monthlyModeOf(rule)).toBe(mode);
    }
  });
});
