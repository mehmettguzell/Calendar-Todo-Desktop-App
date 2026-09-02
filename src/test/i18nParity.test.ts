import { describe, expect, it } from "vitest";
import { DICTIONARY } from "@/lib/i18n";

/**
 * The two dictionaries have to stay the same shape.
 *
 * A key present in one and missing from the other does not fail loudly — `t`
 * falls back to the key itself, so the app quietly renders `menuCopyToTomorrow`
 * in the middle of a menu, and nobody notices until a user does. This test is
 * the thing that notices.
 */
const tr = DICTIONARY.tr as Record<string, string>;
const en = DICTIONARY.en as Record<string, string>;

describe("the dictionaries", () => {
  it("carry exactly the same keys", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty strings", () => {
    for (const [key, value] of Object.entries({ ...tr, ...en })) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  /**
   * `{name}` placeholders are filled in by the caller, so a key whose two
   * translations expect different ones is a sentence with a hole in it.
   */
  it("agree on the placeholders each string expects", () => {
    const holes = (value: string) =>
      (value.match(/\{(\w+)\}/g) ?? []).sort().join(",");

    for (const key of Object.keys(tr)) {
      expect(holes(tr[key] ?? ""), key).toBe(holes(en[key] ?? ""));
    }
  });

  /**
   * Every value in the Turkish dictionary should differ from the English one,
   * with a short allow-list for the words that genuinely are the same in both
   * (product names, units, symbols). A long list of matches is what a
   * half-finished translation looks like.
   */
  it("actually translate, rather than repeating the English", () => {
    const sameInBoth = new Set([
      "tempo",
      "rolePro",
      "subProBadge",
      "navBudget",
      "notesSortTitle",
      "notesHeading",
      // "Limit" is the same word in both.
      "budgetLimit",
      // A language picker names each language in that language, on purpose:
      // someone looking for English cannot read "İngilizce" to find it.
      "langTr",
      "langEn",
      // A sample of what a bank prints. Translating it would make it a worse
      // example of the thing the user is about to paste.
      "importPastePlaceholder",
      // Likewise: an example of a card label, which is not a sentence.
      "spendCardPlaceholder",
    ]);

    const untranslated = Object.keys(tr).filter(
      (key) => !sameInBoth.has(key) && tr[key] === en[key],
    );
    expect(untranslated).toEqual([]);
  });
});
