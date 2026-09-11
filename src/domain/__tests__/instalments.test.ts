import { describe, expect, it } from "vitest";
import {
  chargeRows,
  expandInstalments,
  instalmentCharges,
  instalmentCount,
  instalmentShares,
  outstandingCount,
  outstandingMinor,
} from "../instalments";
import {
  summarise,
  totalsByCategory,
  transactionsInRange,
  type BudgetCategory,
  type Transaction,
} from "../money";
import { analyseSpending } from "../spending";

const AT = "2026-08-20T10:00:00.000Z";

const purchase = (over: Partial<Transaction> = {}): Transaction => ({
  id: "x1",
  date: "2026-08-25",
  amountMinor: 1_200_000,
  flow: "EXPENSE",
  categoryId: "cat-tech",
  note: "Telefon",
  merchant: "Apple",
  instalments: 12,
  createdAt: AT,
  updatedAt: AT,
  deletedAt: null,
  ...over,
});

const AUGUST = { from: "2026-08-01", to: "2026-08-31" };
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
const NEXT_AUGUST = { from: "2027-08-01", to: "2027-08-31" };

describe("splitting a price into charges", () => {
  it("counts a purchase with no plan as one charge", () => {
    expect(instalmentCount(purchase({ instalments: null }))).toBe(1);
    expect(instalmentCount(purchase({ instalments: 1 }))).toBe(1);
  });

  /**
   * The kuruş division loses has to be charged to somebody. Twelve parts that
   * each round on their own stop adding up to the price they came from, and a
   * budget whose parts do not sum to the whole is one nobody checks twice.
   */
  it("makes the parts add back up to the price exactly", () => {
    const shares = instalmentShares(10_000, 3);
    expect(shares).toEqual([3_334, 3_333, 3_333]);
    expect(shares.reduce((sum, part) => sum + part, 0)).toBe(10_000);
  });

  it("charges one month apart from the purchase", () => {
    const charges = instalmentCharges(purchase({ instalments: 3 }));
    expect(charges.map((charge) => charge.date)).toEqual([
      "2026-08-25",
      "2026-09-25",
      "2026-10-25",
    ]);
    expect(charges[0]?.index).toBe(1);
    expect(charges[2]?.count).toBe(3);
  });

  /** The 31st does not exist in September, and the charge cannot be skipped. */
  it("pulls a month-end charge back to the last day that month has", () => {
    const charges = instalmentCharges(
      purchase({ date: "2026-01-31", amountMinor: 300, instalments: 3 }),
    );
    expect(charges.map((charge) => charge.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("leaves an ordinary purchase as itself", () => {
    const entry = purchase({ instalments: null });
    expect(chargeRows(entry)).toEqual([entry]);
  });

  /** Two aggregations over one list must not split the same purchase twice. */
  it("does not split a row that is already a charge", () => {
    const once = expandInstalments([purchase({ instalments: 3 })]);
    const twice = expandInstalments(once);
    expect(twice).toEqual(once);
    expect(twice.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(1_200_000);
  });
});

describe("what a month is charged", () => {
  const entries = [purchase()];

  it("counts one instalment in the month of the purchase, not the price", () => {
    const rows = transactionsInRange(entries, AUGUST);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountMinor).toBe(100_000);
    expect(summarise(rows).expense).toBe(100_000);
  });

  it("keeps charging the months after it", () => {
    expect(summarise(transactionsInRange(entries, SEPTEMBER)).expense).toBe(100_000);
  });

  it("stops once the plan is paid off", () => {
    expect(transactionsInRange(entries, NEXT_AUGUST)).toHaveLength(0);
  });

  it("adds up to the price over the whole run", () => {
    const wholeRun = transactionsInRange(entries, {
      from: "2026-08-01",
      to: "2027-07-31",
    });
    expect(wholeRun).toHaveLength(12);
    expect(summarise(wholeRun).expense).toBe(1_200_000);
  });

  /** The bars under the totals have to agree with the totals above them. */
  it("gives the category the same figure the month total used", () => {
    const rows = transactionsInRange(entries, AUGUST);
    expect(totalsByCategory(rows, "EXPENSE")[0]?.amountMinor).toBe(100_000);
  });

  it("gives the merchant breakdown the same figure too", () => {
    const categories: BudgetCategory[] = [
      {
        id: "cat-tech",
        name: "Teknoloji",
        flow: "EXPENSE",
        color: "#000",
        icon: "•",
        builtIn: false,
        order: 0,
        updatedAt: AT,
      },
    ];
    const report = analyseSpending(entries, categories, AUGUST);
    expect(report.totalMinor).toBe(100_000);
  });
});

describe("the debt behind the month", () => {
  it("reports what is still to be charged", () => {
    const entry = purchase();
    expect(outstandingMinor(entry, "2026-08-31")).toBe(1_100_000);
    expect(outstandingCount(entry, "2026-08-31")).toBe(11);
  });

  it("reports nothing once the last charge has passed", () => {
    expect(outstandingMinor(purchase(), "2027-08-01")).toBe(0);
  });

  it("has nothing to say about a purchase paid in one go", () => {
    expect(outstandingMinor(purchase({ instalments: null }), "2026-08-25")).toBe(0);
  });
});
