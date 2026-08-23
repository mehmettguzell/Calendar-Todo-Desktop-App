import { describe, expect, it } from "vitest";
import {
  burnRatePerDay,
  dailyTotals,
  formatMoney,
  parseAmount,
  periodRange,
  stepPeriod,
  summarise,
  totalsByCategory,
  transactionsInRange,
  type Transaction,
} from "../money";

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "x1",
  date: "2026-08-25",
  amountMinor: 10_00,
  flow: "EXPENSE",
  categoryId: "market",
  note: "",
  createdAt: "2026-08-25T09:00:00.000Z",
  updatedAt: "2026-08-25T09:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

describe("reading an amount the way a person types it", () => {
  it("accepts plain whole numbers", () => {
    expect(parseAmount("120")).toBe(120_00);
  });

  it("accepts both decimal conventions", () => {
    // Turkish and English disagree about which separator means what; whichever
    // comes last is the decimal one.
    expect(parseAmount("1.234,56")).toBe(123_456);
    expect(parseAmount("1,234.56")).toBe(123_456);
  });

  it("treats a trailing group of three as thousands, not cents", () => {
    expect(parseAmount("1.234")).toBe(1_234_00);
    expect(parseAmount("1,234")).toBe(1_234_00);
  });

  it("pads a single decimal digit", () => {
    expect(parseAmount("12,5")).toBe(12_50);
  });

  it("ignores currency symbols and spaces around the number", () => {
    expect(parseAmount(" ₺ 89,90 ")).toBe(89_90);
    expect(parseAmount("$1,500.00")).toBe(1_500_00);
  });

  it("keeps a leading minus", () => {
    expect(parseAmount("-45")).toBe(-45_00);
  });

  it("returns null when there is no number at all", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("never loses a kuruş to floating point", () => {
    // 0.1 + 0.2 in floats is the classic failure; integers make it impossible.
    const total = summarise([
      tx({ id: "a", amountMinor: parseAmount("0,10")! }),
      tx({ id: "b", amountMinor: parseAmount("0,20")! }),
    ]);
    expect(total.expense).toBe(30);
    expect(formatMoney(total.expense, "TRY", "tr-TR")).toContain("0,30");
  });
});

describe("summarising a period", () => {
  const month = [
    tx({ id: "1", flow: "INCOME", amountMinor: 30_000_00, categoryId: "salary" }),
    tx({ id: "2", flow: "EXPENSE", amountMinor: 12_000_00, categoryId: "rent" }),
    tx({ id: "3", flow: "EXPENSE", amountMinor: 3_000_00, categoryId: "market" }),
    tx({ id: "4", flow: "INVESTMENT", amountMinor: 5_000_00, categoryId: "fund" }),
  ];

  it("reports income, expense and investment separately", () => {
    const s = summarise(month);
    expect(s.income).toBe(30_000_00);
    expect(s.expense).toBe(15_000_00);
    expect(s.investment).toBe(5_000_00);
  });

  it("keeps investment out of the net, but inside total outflow", () => {
    // Money moved into savings has left the account but has not been spent;
    // counting it as a loss would make saving look like overspending.
    const s = summarise(month);
    expect(s.net).toBe(15_000_00);
    expect(s.outflow).toBe(20_000_00);
  });

  it("goes negative when spending outruns income", () => {
    expect(summarise([tx({ flow: "EXPENSE", amountMinor: 500_00 })]).net).toBe(-500_00);
  });

  it("ignores deleted rows", () => {
    const s = summarise([
      ...month,
      tx({ id: "gone", amountMinor: 99_999_00, deletedAt: "2026-08-26T00:00:00.000Z" }),
    ]);
    expect(s.expense).toBe(15_000_00);
  });
});

describe("where the money went", () => {
  it("ranks categories by total and scales the bars against the largest", () => {
    const rows = totalsByCategory(
      [
        tx({ id: "1", categoryId: "rent", amountMinor: 12_000_00 }),
        tx({ id: "2", categoryId: "market", amountMinor: 3_000_00 }),
        tx({ id: "3", categoryId: "market", amountMinor: 3_000_00 }),
      ],
      "EXPENSE",
    );

    expect(rows.map((r) => r.categoryId)).toEqual(["rent", "market"]);
    expect(rows[0]!.share).toBe(1);
    expect(rows[1]!.share).toBeCloseTo(0.5);
    expect(rows[1]!.count).toBe(2);
  });

  it("keeps flows apart", () => {
    const rows = totalsByCategory(
      [
        tx({ id: "1", flow: "INCOME", categoryId: "salary", amountMinor: 100 }),
        tx({ id: "2", flow: "EXPENSE", categoryId: "rent", amountMinor: 100 }),
      ],
      "INCOME",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.categoryId).toBe("salary");
  });
});

describe("period windows", () => {
  it("covers a whole calendar month", () => {
    expect(periodRange("2026-08-14", "month")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("handles February in a leap year", () => {
    expect(periodRange("2028-02-10", "month")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("starts the week where the user's settings say", () => {
    // 2026-08-25 is a Tuesday.
    expect(periodRange("2026-08-25", "week", 1)).toEqual({
      from: "2026-08-24",
      to: "2026-08-30",
    });
    expect(periodRange("2026-08-25", "week", 0)).toEqual({
      from: "2026-08-23",
      to: "2026-08-29",
    });
  });

  it("steps a month at a time without drifting off the end", () => {
    expect(stepPeriod("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(stepPeriod("2026-03-15", "month", -1)).toBe("2026-02-01");
  });
});

describe("daily buckets", () => {
  const range = { from: "2026-08-24", to: "2026-08-26" };

  it("keeps the empty days", () => {
    const days = dailyTotals([tx({ date: "2026-08-25", amountMinor: 90_00 })], range);
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
    ]);
    expect(days[0]!.expense).toBe(0);
    expect(days[1]!.expense).toBe(90_00);
  });

  it("averages the outflow across the whole window, gaps included", () => {
    expect(
      burnRatePerDay([tx({ date: "2026-08-25", amountMinor: 90_00 })], range),
    ).toBe(30_00); // ₺90 spread over three days
  });
});

describe("selecting a window", () => {
  it("returns only live rows inside it, newest first", () => {
    const rows = transactionsInRange(
      [
        tx({ id: "old", date: "2026-07-30" }),
        tx({ id: "a", date: "2026-08-25" }),
        tx({ id: "b", date: "2026-08-27" }),
        tx({ id: "trashed", date: "2026-08-26", deletedAt: "2026-08-27T00:00:00.000Z" }),
      ],
      { from: "2026-08-01", to: "2026-08-31" },
    );

    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
