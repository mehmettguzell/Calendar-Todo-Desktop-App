import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/data/db";
import type { Transaction } from "../money";
import type { Settings } from "../types";
import { daySpending, spendNudgeDue } from "../spendLog";

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

/** Local time, because the nudge is about the user's evening, not UTC's. */
function at(date: string, time: string): Date {
  const [h, m] = time.split(":");
  const d = new Date(`${date}T00:00:00`);
  d.setHours(Number(h), Number(m), 0, 0);
  return d;
}

describe("when the day's prompt is owed", () => {
  it("stays quiet before the chosen hour", () => {
    expect(spendNudgeDue(settings({ spendNudgeTime: "21:00" }), at("2026-08-25", "20:59"))).toBe(
      false,
    );
  });

  it("comes due on the hour", () => {
    expect(spendNudgeDue(settings({ spendNudgeTime: "21:00" }), at("2026-08-25", "21:00"))).toBe(
      true,
    );
  });

  /**
   * The app is closed most evenings at nine. A prompt that only fires if you
   * happen to be looking at the screen is not a prompt.
   */
  it("is still owed when the app is opened late", () => {
    expect(spendNudgeDue(settings({ spendNudgeTime: "21:00" }), at("2026-08-25", "23:40"))).toBe(
      true,
    );
  });

  it("fires once a day and not again", () => {
    const answered = settings({ spendNudgeTime: "21:00", lastSpendNudgeOn: "2026-08-25" });
    expect(spendNudgeDue(answered, at("2026-08-25", "23:40"))).toBe(false);
  });

  /** Yesterday's question is not worth asking; nobody remembers the answer. */
  it("does not chase a day that has already rolled over", () => {
    const answered = settings({ spendNudgeTime: "21:00", lastSpendNudgeOn: "2026-08-24" });
    expect(spendNudgeDue(answered, at("2026-08-25", "08:00"))).toBe(false);
    expect(spendNudgeDue(answered, at("2026-08-25", "21:30"))).toBe(true);
  });

  it("says nothing at all when it is switched off", () => {
    const off = settings({ spendNudgeEnabled: false, spendNudgeTime: "21:00" });
    expect(spendNudgeDue(off, at("2026-08-25", "23:00"))).toBe(false);
  });

  it("is on by default, at nine in the evening", () => {
    expect(spendNudgeDue(settings(), at("2026-08-25", "20:00"))).toBe(false);
    expect(spendNudgeDue(settings(), at("2026-08-25", "21:00"))).toBe(true);
  });
});

function entry(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: "2026-08-25",
    amountMinor: 10_000,
    flow: "EXPENSE",
    categoryId: null,
    note: "",
    recurrence: null,
    recurrenceSourceId: null,
    lastGeneratedFor: null,
    createdAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T09:00:00.000Z",
    deletedAt: null,
    ...partial,
  };
}

describe("what the day already holds", () => {
  const rows = [
    entry({ id: "a", amountMinor: 25_000 }),
    entry({ id: "b", amountMinor: 8_750, origin: "alert" }),
    entry({ id: "c", amountMinor: 500_000, flow: "INCOME" }),
    entry({ id: "d", amountMinor: 100_000, flow: "INVESTMENT", origin: "statement" }),
    entry({ id: "e", date: "2026-08-24" }),
    entry({ id: "f", deletedAt: "2026-08-25T10:00:00.000Z" }),
  ];

  it("counts what went out, investments included", () => {
    expect(daySpending(rows, "2026-08-25").outflowMinor).toBe(133_750);
  });

  it("leaves income out of the count of purchases", () => {
    expect(daySpending(rows, "2026-08-25").count).toBe(3);
  });

  it("ignores other days and deleted rows", () => {
    expect(daySpending(rows, "2026-08-25").entries.map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  /** The count that tells the user which numbers can still change. */
  it("counts the entries no statement has confirmed yet", () => {
    expect(daySpending(rows, "2026-08-25").provisionalCount).toBe(3);
  });
});
