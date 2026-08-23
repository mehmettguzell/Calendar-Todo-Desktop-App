import { describe, expect, it } from "vitest";
import {
  dueRecurringTransactions,
  limitStatus,
  type Transaction,
} from "../money";

const rent = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "rent",
  date: "2026-01-05",
  amountMinor: 12_000_00,
  flow: "EXPENSE",
  categoryId: "kira",
  note: "",
  recurrence: { freq: "MONTHLY", interval: 1 },
  recurrenceSourceId: null,
  lastGeneratedFor: null,
  createdAt: "2026-01-05T09:00:00.000Z",
  updatedAt: "2026-01-05T09:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

describe("what a repeating entry still owes", () => {
  it("produces one entry per period up to today", () => {
    const due = dueRecurringTransactions([rent()], "2026-04-10");
    expect(due.map((d) => d.date)).toEqual([
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
    ]);
  });

  it("never produces the template's own first entry twice", () => {
    // The template *is* January's rent; generating it again would double it.
    const due = dueRecurringTransactions([rent()], "2026-01-31");
    expect(due).toEqual([]);
  });

  it("never runs ahead of today", () => {
    // A budget already containing next month's rent lies about where you stand.
    const due = dueRecurringTransactions([rent()], "2026-02-04");
    expect(due).toEqual([]);
  });

  it("picks up exactly where it left off", () => {
    const due = dueRecurringTransactions(
      [rent({ lastGeneratedFor: "2026-03-05" })],
      "2026-05-10",
    );
    expect(due.map((d) => d.date)).toEqual(["2026-04-05", "2026-05-05"]);
  });

  it("catches up on months the app was closed for", () => {
    const due = dueRecurringTransactions([rent()], "2026-12-31");
    expect(due).toHaveLength(11);
  });

  it("ignores entries with no rule, and deleted templates", () => {
    expect(
      dueRecurringTransactions([rent({ recurrence: null })], "2026-06-01"),
    ).toEqual([]);
    expect(
      dueRecurringTransactions(
        [rent({ deletedAt: "2026-02-01T00:00:00.000Z" })],
        "2026-06-01",
      ),
    ).toEqual([]);
  });

  it("handles weekly and yearly rules too", () => {
    const weekly = rent({ recurrence: { freq: "WEEKLY", interval: 1 } });
    expect(dueRecurringTransactions([weekly], "2026-01-26").map((d) => d.date)).toEqual([
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);

    const yearly = rent({ recurrence: { freq: "YEARLY", interval: 1 } });
    expect(dueRecurringTransactions([yearly], "2028-01-06").map((d) => d.date)).toEqual([
      "2027-01-05",
      "2028-01-05",
    ]);
  });

  it("carries the template's amount and category to each entry it owes", () => {
    const due = dueRecurringTransactions([rent()], "2026-03-10");
    expect(due[0]?.source.amountMinor).toBe(12_000_00);
    expect(due[0]?.source.categoryId).toBe("kira");
  });
});

describe("monthly limits", () => {
  it("reports nothing when no limit is set", () => {
    expect(limitStatus(null, 5_000_00)).toBeNull();
    expect(limitStatus(0, 5_000_00)).toBeNull();
  });

  it("stays quiet well under the ceiling", () => {
    expect(limitStatus(3_000_00, 1_000_00)?.state).toBe("ok");
  });

  it("warns at 80%, not at 100% — there has to be time to act", () => {
    expect(limitStatus(3_000_00, 2_400_00)?.state).toBe("close");
    expect(limitStatus(3_000_00, 2_399_00)?.state).toBe("ok");
  });

  it("flags going over, and reports by how much", () => {
    const status = limitStatus(3_000_00, 3_600_00);
    expect(status?.state).toBe("over");
    expect(status?.ratio).toBeCloseTo(1.2);
  });

  it("treats spending exactly the limit as not yet over", () => {
    expect(limitStatus(3_000_00, 3_000_00)?.state).toBe("close");
  });
});
