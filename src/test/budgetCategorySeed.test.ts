import { describe, expect, it } from "vitest";
import { emptyDatabase, migrate } from "@/data/db";
import { BUDGET_SEED_VERSION } from "@/domain/money";

/**
 * A budget label that arrives after the document did.
 *
 * The task categories already worked this way — seeds are a *suggestion*,
 * offered once, so the app can tell "you have never been shown this" from "you
 * were, and you deleted it". The budget's own labels had no such mechanism at
 * all: a new one reached a new account and nobody else, ever.
 */
const names = (db: ReturnType<typeof migrate>) =>
  db.budgetCategories.map((c) => c.name);

/** A document from before the round existed: no version stamp on it. */
const oldDocument = (over: Record<string, unknown> = {}) => {
  const base = emptyDatabase();
  return {
    ...base,
    budgetCategories: base.budgetCategories.filter(
      (c) => c.name !== "Alışveriş" && c.name !== "Sigara",
    ),
    settings: { ...base.settings, budgetCategorySeedVersion: undefined },
    ...over,
  } as unknown as Record<string, unknown>;
};

describe("the budget categories", () => {
  it("ship with the new ones on a fresh document", () => {
    expect(names(emptyDatabase() as never)).toContain("Alışveriş");
    expect(names(emptyDatabase() as never)).toContain("Sigara");
  });

  it("offers them to a document written before they existed", () => {
    const migrated = migrate(oldDocument());

    expect(names(migrated)).toContain("Alışveriş");
    expect(names(migrated)).toContain("Sigara");
    expect(migrated.settings.budgetCategorySeedVersion).toBe(BUDGET_SEED_VERSION);
  });

  it("keeps what was already there", () => {
    const migrated = migrate(oldDocument());
    // The eleven it always shipped with are untouched by the offer.
    expect(names(migrated)).toContain("Market");
    expect(names(migrated)).toContain("Maaş");
  });

  it("offers them exactly once, so deleting one is final", () => {
    const once = migrate(oldDocument());
    const withoutTobacco = {
      ...once,
      budgetCategories: once.budgetCategories.filter((c) => c.name !== "Sigara"),
    } as unknown as Record<string, unknown>;

    // Second pass: the version stamp says this document has already been asked.
    expect(names(migrate(withoutTobacco))).not.toContain("Sigara");
  });

  it("does not add a second one beside a category of the same name", () => {
    const mine = emptyDatabase();
    const doc = {
      ...mine,
      budgetCategories: [
        ...mine.budgetCategories.filter((c) => c.name !== "Sigara"),
        {
          id: "b-mine",
          name: "Sigara",
          flow: "EXPENSE",
          color: "#000000",
          icon: "🚬",
          builtIn: false,
          order: 99,
          updatedAt: new Date().toISOString(),
        },
      ],
      settings: { ...mine.settings, budgetCategorySeedVersion: undefined },
    } as unknown as Record<string, unknown>;

    const migrated = migrate(doc);
    expect(names(migrated).filter((n) => n === "Sigara")).toHaveLength(1);
  });
});
