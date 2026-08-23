import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";

/**
 * Turning repeating entries into real ones.
 *
 * The property that matters is idempotence: this runs every time the budget is
 * opened, and running it twice in one day must not bill the user twice.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const live = () =>
  useStore.getState().db.transactions.filter((t) => t.deletedAt === null);

const addRent = () =>
  useStore.getState().addTransaction({
    date: "2026-01-05",
    amountMinor: 12_000_00,
    flow: "EXPENSE",
    categoryId: null,
    note: "Kira",
    recurrence: { freq: "MONTHLY", interval: 1 },
  });

describe("materialiseRecurringTransactions", () => {
  it("creates the entries a template owes", () => {
    addRent();
    const created = useStore.getState().materialiseRecurringTransactions("2026-03-10");

    expect(created).toBe(2);
    expect(live().map((t) => t.date).sort()).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
    ]);
  });

  it("is idempotent — running it again the same day creates nothing", () => {
    addRent();
    useStore.getState().materialiseRecurringTransactions("2026-03-10");
    const after = live().length;

    expect(useStore.getState().materialiseRecurringTransactions("2026-03-10")).toBe(0);
    expect(live()).toHaveLength(after);
  });

  it("resumes from where it stopped when time moves on", () => {
    addRent();
    useStore.getState().materialiseRecurringTransactions("2026-03-10");

    expect(useStore.getState().materialiseRecurringTransactions("2026-05-10")).toBe(2);
    expect(live()).toHaveLength(5);
  });

  it("copies the amount and note, and marks where each entry came from", () => {
    const template = addRent();
    useStore.getState().materialiseRecurringTransactions("2026-02-10");

    const generated = live().find((t) => t.date === "2026-02-05");
    expect(generated?.amountMinor).toBe(12_000_00);
    expect(generated?.note).toBe("Kira");
    expect(generated?.recurrenceSourceId).toBe(template.id);
  });

  it("gives generated entries no rule of their own", () => {
    addRent();
    useStore.getState().materialiseRecurringTransactions("2026-04-10");

    // Otherwise every generated entry would start generating entries itself.
    const copies = live().filter((t) => t.recurrenceSourceId !== null);
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((t) => !t.recurrence)).toBe(true);
  });

  it("lets a generated entry be corrected without affecting the template", () => {
    const template = addRent();
    useStore.getState().materialiseRecurringTransactions("2026-02-10");
    const generated = live().find((t) => t.date === "2026-02-05")!;

    // February's rent went up. That is an edit, not a new kind of record.
    useStore.getState().updateTransaction(generated.id, { amountMinor: 13_000_00 });

    expect(live().find((t) => t.id === generated.id)?.amountMinor).toBe(13_000_00);
    expect(live().find((t) => t.id === template.id)?.amountMinor).toBe(12_000_00);
  });

  it("stops producing once the template is deleted", () => {
    const template = addRent();
    useStore.getState().materialiseRecurringTransactions("2026-02-10");
    useStore.getState().deleteTransaction(template.id);

    expect(useStore.getState().materialiseRecurringTransactions("2026-06-10")).toBe(0);
  });

  it("leaves one-off entries completely alone", () => {
    useStore.getState().addTransaction({
      date: "2026-01-05",
      amountMinor: 45_00,
      flow: "EXPENSE",
      categoryId: null,
    });

    expect(useStore.getState().materialiseRecurringTransactions("2027-01-01")).toBe(0);
    expect(live()).toHaveLength(1);
  });
});

describe("category limits", () => {
  it("stores a monthly ceiling on the category", () => {
    const category = useStore.getState().ensureBudgetCategory("Market", "EXPENSE");
    useStore
      .getState()
      .updateBudgetCategory(category.id, { monthlyLimitMinor: 3_000_00 });

    expect(
      useStore.getState().db.budgetCategories.find((c) => c.id === category.id)
        ?.monthlyLimitMinor,
    ).toBe(3_000_00);
  });

  it("clears the ceiling when it is set back to nothing", () => {
    const category = useStore.getState().ensureBudgetCategory("Market", "EXPENSE");
    useStore
      .getState()
      .updateBudgetCategory(category.id, { monthlyLimitMinor: 3_000_00 });
    useStore
      .getState()
      .updateBudgetCategory(category.id, { monthlyLimitMinor: null });

    expect(
      useStore.getState().db.budgetCategories.find((c) => c.id === category.id)
        ?.monthlyLimitMinor,
    ).toBeNull();
  });
});
