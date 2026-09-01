import { describe, expect, it } from "vitest";
import {
  fixedCostTotals,
  fixedCostsInRange,
  recurringTemplates,
  type Transaction,
} from "../money";

/**
 * What the fixed-cost panel is for.
 *
 * The ledger deliberately refuses to write next week's rent, so the only place
 * "there is still 12.000 to go out this month" can come from is here. These
 * tests pin the two halves of that: what the window owes, and what of it has
 * actually landed.
 */
const entry = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "x1",
  date: "2026-09-05",
  amountMinor: 12_000_00,
  flow: "EXPENSE",
  categoryId: "kira",
  note: "Kira",
  recurrence: null,
  recurrenceSourceId: null,
  lastGeneratedFor: null,
  createdAt: "2026-09-05T09:00:00.000Z",
  updatedAt: "2026-09-05T09:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const rent = (overrides: Partial<Transaction> = {}) =>
  entry({
    id: "rent",
    date: "2026-01-05",
    recurrence: { freq: "MONTHLY", interval: 1 },
    ...overrides,
  });

const september = { from: "2026-09-01", to: "2026-09-30" };

describe("recurringTemplates", () => {
  it("keeps only the entries that carry a rule", () => {
    const list = recurringTemplates([rent(), entry({ id: "one-off" })]);
    expect(list.map((t) => t.id)).toEqual(["rent"]);
  });

  it("ignores a template that has been deleted", () => {
    expect(
      recurringTemplates([rent({ deletedAt: "2026-02-01T00:00:00.000Z" })]),
    ).toEqual([]);
  });

  it("reads income first, then what goes out, largest first inside each", () => {
    const salary = rent({ id: "salary", flow: "INCOME", amountMinor: 45_000_00 });
    const gym = rent({ id: "gym", amountMinor: 500_00 });
    const list = recurringTemplates([gym, rent(), salary]);
    expect(list.map((t) => t.id)).toEqual(["salary", "rent", "gym"]);
  });
});

describe("fixedCostsInRange", () => {
  it("reports the date the rule owes this window even before it is written", () => {
    const [row] = fixedCostsInRange([rent()], september, "2026-09-01");

    expect(row?.dates).toEqual(["2026-09-05"]);
    expect(row?.pendingDates).toEqual(["2026-09-05"]);
    expect(row?.recorded).toEqual([]);
    // The number the ledger cannot show on the 1st.
    expect(row?.expectedMinor).toBe(12_000_00);
    expect(row?.recordedMinor).toBe(0);
  });

  it("counts an entry the template has already produced", () => {
    const produced = entry({
      id: "sept",
      date: "2026-09-05",
      recurrenceSourceId: "rent",
    });
    const [row] = fixedCostsInRange([rent(), produced], september, "2026-09-10");

    expect(row?.pendingDates).toEqual([]);
    expect(row?.recorded.map((e) => e.id)).toEqual(["sept"]);
    expect(row?.recordedMinor).toBe(12_000_00);
  });

  it("counts a recorded entry at what was actually charged, not the standing figure", () => {
    // Rent really was 500 more in September. A forecast that overwrites that
    // argues with the ledger sitting underneath it.
    const produced = entry({
      id: "sept",
      date: "2026-09-05",
      amountMinor: 12_500_00,
      recurrenceSourceId: "rent",
    });
    const [row] = fixedCostsInRange([rent(), produced], september, "2026-09-10");

    expect(row?.expectedMinor).toBe(12_500_00);
  });

  it("treats the template's own row as the occurrence it is", () => {
    // January is the template itself; nothing was generated for it.
    const [row] = fixedCostsInRange(
      [rent()],
      { from: "2026-01-01", to: "2026-01-31" },
      "2026-01-31",
    );

    expect(row?.recorded.map((e) => e.id)).toEqual(["rent"]);
    expect(row?.pendingDates).toEqual([]);
  });

  it("says nothing is due in a window the rule does not reach", () => {
    const [row] = fixedCostsInRange(
      [rent({ recurrence: { freq: "YEARLY", interval: 1 } })],
      september,
      "2026-09-10",
    );

    expect(row?.dates).toEqual([]);
    expect(row?.expectedMinor).toBe(0);
    // Still worth showing, with the date it next comes round.
    expect(row?.nextDate).toBe("2027-01-05");
  });

  it("reports no next date once the rule has run out", () => {
    const [row] = fixedCostsInRange(
      [rent({ recurrence: { freq: "MONTHLY", interval: 1, until: "2026-06-30" } })],
      september,
      "2026-09-10",
    );

    expect(row?.dates).toEqual([]);
    expect(row?.nextDate).toBeNull();
  });

  it("handles a rule that lands more than once in the window", () => {
    const [row] = fixedCostsInRange(
      [rent({ date: "2026-09-01", recurrence: { freq: "WEEKLY", interval: 1 } })],
      september,
      "2026-09-10",
    );

    expect(row?.dates).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
    expect(row?.expectedMinor).toBe(5 * 12_000_00);
  });

  it("follows the day of the month the rule names, not the anchor's", () => {
    const [row] = fixedCostsInRange(
      [rent({ recurrence: { freq: "MONTHLY", interval: 1, byMonthDay: 20 } })],
      september,
      "2026-09-01",
    );

    expect(row?.dates).toEqual(["2026-09-20"]);
  });
});

describe("fixedCostTotals", () => {
  it("splits the standing entries by direction and reports what is still to come", () => {
    const salary = rent({
      id: "salary",
      flow: "INCOME",
      amountMinor: 45_000_00,
      date: "2026-01-01",
    });
    const producedSalary = entry({
      id: "sept-salary",
      date: "2026-09-01",
      flow: "INCOME",
      amountMinor: 45_000_00,
      recurrenceSourceId: "salary",
    });

    const rows = fixedCostsInRange(
      [rent(), salary, producedSalary],
      september,
      "2026-09-03",
    );
    const totals = fixedCostTotals(rows);

    expect(totals.income).toBe(45_000_00);
    expect(totals.expense).toBe(12_000_00);
    // The salary has landed; the rent has not.
    expect(totals.outstanding).toBe(12_000_00);
  });

  it("is all zeroes when there is nothing standing", () => {
    expect(fixedCostTotals([])).toEqual({
      income: 0,
      expense: 0,
      investment: 0,
      outstanding: 0,
    });
  });
});
