import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain/money";
import {
  MIN_SHORTFALL_MINOR,
  dailyShortfalls,
  shortfallExternalId,
} from "@/domain/statementBatch";

/**
 * "I write down what I ate, but I forget things."
 *
 * The user logs spending by hand as it happens and misses some of it — a
 * forgotten coffee, and the kuruş on a basket they wrote down as 250. Matching
 * the bank's rows to those entries one by one cannot work: they were never
 * records of the bank's rows in the first place. The day's total is the only
 * figure both sides can be held to, so the difference between the two is what
 * gets written, and nothing already in the ledger is touched.
 */

const at = "2026-08-01T09:00:00.000Z";

const entry = (over: Partial<Transaction>): Transaction => ({
  id: "x",
  date: "2026-08-10",
  amountMinor: 0,
  flow: "EXPENSE",
  categoryId: null,
  note: "",
  recurrence: null,
  recurrenceSourceId: null,
  lastGeneratedFor: null,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  ...over,
});

const row = (date: string, amountMinor: number, flow: Transaction["flow"] = "EXPENSE") => ({
  date,
  amountMinor,
  flow,
});

describe("the day's shortfall", () => {
  it("is the whole day when nothing was written down", () => {
    expect(dailyShortfalls([row("2026-08-10", 25_000)], [])).toEqual([
      {
        date: "2026-08-10",
        statementMinor: 25_000,
        recordedMinor: 0,
        shortfallMinor: 25_000,
        rowCount: 1,
      },
    ]);
  });

  it("is only the kurus when the user rounded the basket down", () => {
    const days = dailyShortfalls(
      [row("2026-08-10", 25_340)],
      [entry({ amountMinor: 25_000 })],
    );

    expect(days).toHaveLength(1);
    expect(days[0]!.shortfallMinor).toBe(340);
  });

  it("is the forgotten coffee, not the whole day", () => {
    const days = dailyShortfalls(
      [row("2026-08-10", 25_000), row("2026-08-10", 4_500)],
      [entry({ amountMinor: 25_000 })],
    );

    expect(days[0]!.shortfallMinor).toBe(4_500);
    expect(days[0]!.rowCount).toBe(2);
  });

  it("leaves a day alone once the ledger already covers it", () => {
    expect(
      dailyShortfalls([row("2026-08-10", 25_000)], [entry({ amountMinor: 25_000 })]),
    ).toEqual([]);
  });

  /**
   * The statement is the card, not the wallet. A day where more was written
   * down than the bank charged is a day with cash in it, and correcting that
   * downwards would delete something a person typed to make a total agree.
   */
  it("never corrects a day downwards", () => {
    expect(
      dailyShortfalls([row("2026-08-10", 10_000)], [entry({ amountMinor: 40_000 })]),
    ).toEqual([]);
  });

  it("ignores a gap too small to be worth a row", () => {
    expect(
      dailyShortfalls(
        [row("2026-08-10", 25_000 + MIN_SHORTFALL_MINOR - 1)],
        [entry({ amountMinor: 25_000 })],
      ),
    ).toEqual([]);
  });

  it("counts income and refunds on neither side", () => {
    const days = dailyShortfalls(
      [row("2026-08-10", 25_000), row("2026-08-10", 900_000, "INCOME")],
      [entry({ amountMinor: 900_000, flow: "INCOME" })],
    );

    expect(days[0]!.shortfallMinor).toBe(25_000);
  });

  it("ignores entries the user has thrown away", () => {
    const days = dailyShortfalls(
      [row("2026-08-10", 25_000)],
      [entry({ amountMinor: 25_000, deletedAt: at })],
    );

    expect(days[0]!.shortfallMinor).toBe(25_000);
  });

  it("keeps days apart rather than netting the month off", () => {
    const days = dailyShortfalls(
      [row("2026-08-10", 30_000), row("2026-08-11", 10_000)],
      [entry({ date: "2026-08-11", amountMinor: 40_000 })],
    );

    expect(days.map((d) => [d.date, d.shortfallMinor])).toEqual([
      ["2026-08-10", 30_000],
    ]);
  });

  it("returns the days in date order", () => {
    const days = dailyShortfalls(
      [row("2026-08-20", 5_000), row("2026-08-02", 5_000), row("2026-08-11", 5_000)],
      [],
    );

    expect(days.map((d) => d.date)).toEqual([
      "2026-08-02",
      "2026-08-11",
      "2026-08-20",
    ]);
  });

  it("holds nothing at all against an empty statement", () => {
    expect(dailyShortfalls([], [entry({ amountMinor: 25_000 })])).toEqual([]);
  });
});

describe("a top-up's identity", () => {
  const day = {
    date: "2026-08-10",
    statementMinor: 25_340,
    recordedMinor: 25_000,
    shortfallMinor: 340,
    rowCount: 1,
  };

  it("is the same for the same file imported twice, so the second is skipped", () => {
    expect(shortfallExternalId(day)).toBe(shortfallExternalId({ ...day }));
  });

  /**
   * Importing a fuller statement after writing more down by hand is a genuinely
   * different correction — the day's arithmetic has moved — so it must not
   * collide with the first one and be silently dropped.
   */
  it("changes once the ledger for that day has changed", () => {
    expect(shortfallExternalId(day)).not.toBe(
      shortfallExternalId({ ...day, recordedMinor: 20_000 }),
    );
  });

  it("keeps two different days apart", () => {
    expect(shortfallExternalId(day)).not.toBe(
      shortfallExternalId({ ...day, date: "2026-08-11" }),
    );
  });
});
