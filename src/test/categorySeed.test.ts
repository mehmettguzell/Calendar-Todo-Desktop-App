import { describe, expect, it } from "vitest";
import { CATEGORY_SEED_VERSION, emptyDatabase, migrate } from "@/data/db";
import type { Database } from "@/data/db";
import type { Category } from "@/domain/types";

/**
 * Seeded categories are a suggestion, offered once.
 *
 * The failure this guards against is the app arguing with the user: putting a
 * category back every launch because it cannot tell "never offered" from
 * "offered, and thrown away".
 */
const names = (db: Database) => db.categories.map((c) => c.name);

const category = (name: string, order: number): Category => ({
  id: `c${order}`,
  name,
  color: "#3b82f6",
  order,
});

/** A document written before the second round of seeds existed. */
const oldDocument = (extra: Partial<Database> = {}): unknown => ({
  version: 2,
  tasks: [],
  categories: [
    category("İş", 0),
    category("Kişisel", 1),
    category("Sağlık", 2),
  ],
  settings: { language: "tr" },
  ...extra,
});

describe("seeding categories", () => {
  it("starts a fresh document with every round", () => {
    expect(names(emptyDatabase())).toEqual([
      "İş", "Kişisel", "Sağlık", "Ev", "Alışveriş", "Öğrenme", "Ulaşım", "Finans", "Sosyal",
    ]);
  });

  it("offers an older document the rounds it missed", () => {
    const migrated = migrate(oldDocument());
    expect(names(migrated)).toEqual([
      "İş", "Kişisel", "Sağlık", "Ev", "Alışveriş", "Öğrenme", "Ulaşım", "Finans", "Sosyal",
    ]);
  });

  it("stamps the document so the offer is not repeated", () => {
    const once = migrate(oldDocument());
    expect(once.settings.categorySeedVersion).toBe(CATEGORY_SEED_VERSION);

    // Round-tripping the migrated document must not add anything again.
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(names(twice)).toEqual(names(once));
  });

  /** The whole reason the version stamp exists. */
  it("never brings back a category the user deleted", () => {
    const stamped = migrate(oldDocument());
    const withoutErrands = {
      ...stamped,
      categories: stamped.categories.filter((c) => c.name !== "Alışveriş"),
    };

    const again = migrate(JSON.parse(JSON.stringify(withoutErrands)));

    expect(names(again)).not.toContain("Alışveriş");
  });

  it("leaves a renamed category alone rather than re-adding the original", () => {
    const renamed = oldDocument({
      categories: [category("Mesai", 0), category("Kişisel", 1), category("Sağlık", 2)],
    });
    const migrated = migrate(renamed);

    expect(names(migrated)).toContain("Mesai");
    expect(names(migrated)).not.toContain("İş");
  });

  it("does not duplicate a name the user had already created themselves", () => {
    const withHome = oldDocument({
      categories: [category("İş", 0), category("ev", 1)],
    });
    const migrated = migrate(withHome);

    // Matched case-insensitively: their "ev" is the same bucket as the seed.
    expect(names(migrated).filter((n) => n.toLowerCase() === "ev")).toHaveLength(1);
  });

  it("seeds in the document's own language", () => {
    const english = migrate({
      version: 2,
      categories: [category("Work", 0)],
      settings: { language: "en" },
    });
    expect(names(english)).toContain("Errands");
    expect(names(english)).not.toContain("Alışveriş");
  });
});
