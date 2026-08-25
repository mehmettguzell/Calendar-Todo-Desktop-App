import { describe, expect, it } from "vitest";
import type { Transaction } from "../money";
import {
  matchRows,
  matchableEntries,
  scoreMatch,
  settlePatch,
  type Matchable,
} from "../reconcile";

function entry(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: "2026-08-25",
    amountMinor: 25_000,
    flow: "EXPENSE",
    categoryId: null,
    note: "",
    recurrence: null,
    recurrenceSourceId: null,
    lastGeneratedFor: null,
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
    deletedAt: null,
    ...partial,
  };
}

const row: Matchable = {
  date: "2026-08-25",
  amountMinor: 25_000,
  flow: "EXPENSE",
  merchant: "Migros",
};

describe("what may be matched at all", () => {
  it("leaves rows a statement already wrote alone", () => {
    const entries = [
      entry({ id: "a" }),
      entry({ id: "b", externalId: "stmt:2026-08-25:25000:MIGROS:1" }),
      entry({ id: "c", deletedAt: "2026-08-25T13:00:00.000Z" }),
      entry({ id: "d", confirmedAt: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(matchableEntries(entries).map((e) => e.id)).toEqual(["a"]);
  });

  /**
   * The three witnesses arrive in order. An entry the notification mail has
   * already stamped is still waiting for the statement to say what it finally
   * cost, so it stays claimable.
   */
  it("keeps an entry a notification mail wrote available to the statement", () => {
    const entries = [entry({ id: "a", origin: "alert", externalId: "alert:4821" })];
    expect(matchableEntries(entries).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("scoring one candidate", () => {
  it("accepts the same purchase posted three days later", () => {
    const match = scoreMatch(row, entry({ id: "a", date: "2026-08-28" }));
    expect(match).not.toBeNull();
    expect(match?.distanceDays).toBe(3);
  });

  it("refuses one posted outside the window", () => {
    expect(scoreMatch(row, entry({ id: "a", date: "2026-08-30" }))).toBeNull();
  });

  /**
   * The amount is the one thing all three witnesses agree on, so it is the one
   * hard rule. Loosening it would merge two genuinely separate purchases, and
   * nothing in the ledger records a row that should have been there.
   */
  it("refuses an amount that is off by a single kuruş", () => {
    expect(scoreMatch(row, entry({ id: "a", amountMinor: 25_001 }))).toBeNull();
  });

  it("refuses money moving the other way", () => {
    expect(scoreMatch(row, entry({ id: "a", flow: "INCOME" }))).toBeNull();
  });

  it("refuses a purchase the user filed under a different card", () => {
    const match = scoreMatch({ ...row, account: "Bonus ••1234" }, entry({ id: "a", account: "World ••9012" }));
    expect(match).toBeNull();
  });

  it("allows an entry with no card named against a statement that has one", () => {
    const match = scoreMatch({ ...row, account: "Bonus ••1234" }, entry({ id: "a" }));
    expect(match).not.toBeNull();
  });

  it("recognises a merchant the statement spelled out in full", () => {
    const match = scoreMatch(
      { ...row, merchant: "MIGROS TIC.A.S-KADIKOY" },
      entry({ id: "a", merchant: "Migros" }),
    );
    expect(match?.sameMerchant).toBe(true);
  });

  it("prefers the same day over a nearby one", () => {
    const near = scoreMatch(row, entry({ id: "a" }))?.score ?? 0;
    const far = scoreMatch(row, entry({ id: "b", date: "2026-08-27" }))?.score ?? 0;
    expect(near).toBeGreaterThan(far);
  });
});

describe("allocating a whole statement", () => {
  /**
   * Two coffees of the same price in the same week is the case that breaks
   * row-by-row matching: both rows would claim whichever entry came first,
   * leaving the second to import as a duplicate beside the entry it should
   * have taken.
   */
  it("never lets two rows claim the same entry", () => {
    const rows: (Matchable & { id: string })[] = [
      { id: "r1", date: "2026-08-25", amountMinor: 8_750, flow: "EXPENSE", merchant: "Starbucks" },
      { id: "r2", date: "2026-08-26", amountMinor: 8_750, flow: "EXPENSE", merchant: "Starbucks" },
    ];
    const entries = [
      entry({ id: "e1", date: "2026-08-25", amountMinor: 8_750, merchant: "Starbucks" }),
      entry({ id: "e2", date: "2026-08-26", amountMinor: 8_750, merchant: "Starbucks" }),
    ];

    const matched = matchRows(rows, entries, (r) => r.id);
    expect(matched.get("r1")?.entry.id).toBe("e1");
    expect(matched.get("r2")?.entry.id).toBe("e2");
  });

  it("leaves a row unmatched when the only candidate is taken", () => {
    const rows: (Matchable & { id: string })[] = [
      { id: "r1", date: "2026-08-25", amountMinor: 8_750, flow: "EXPENSE" },
      { id: "r2", date: "2026-08-25", amountMinor: 8_750, flow: "EXPENSE" },
    ];
    const entries = [entry({ id: "e1", amountMinor: 8_750 })];

    const matched = matchRows(rows, entries, (r) => r.id);
    expect(matched.size).toBe(1);
  });

  it("gives the entry to the row that agrees about the merchant", () => {
    const rows: (Matchable & { id: string })[] = [
      { id: "r1", date: "2026-08-25", amountMinor: 25_000, flow: "EXPENSE", merchant: "Trendyol" },
      { id: "r2", date: "2026-08-25", amountMinor: 25_000, flow: "EXPENSE", merchant: "Migros" },
    ];
    const entries = [entry({ id: "e1", merchant: "Migros" })];

    expect(matchRows(rows, entries, (r) => r.id).get("r2")?.entry.id).toBe("e1");
  });
});

describe("settling a matched entry", () => {
  const settled = {
    externalId: "stmt:2026-08-27:25000:MIGROS:1",
    merchant: "Migros",
    categoryId: "cat-market",
    date: "2026-08-27",
  };

  it("stamps the fingerprint so a re-import cannot make a twin", () => {
    const patch = settlePatch(entry({ id: "a", origin: "alert" }), settled, {
      at: "2026-09-01T00:00:00.000Z",
    });
    expect(patch.externalId).toBe(settled.externalId);
    expect(patch.confirmedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("remembers that the user logged this one themselves", () => {
    const patch = settlePatch(entry({ id: "a", origin: "manual" }), settled, { at: "x" });
    expect(patch.origin).toBe("manual");
  });

  /** A category the user chose outranks one guessed from a merchant name. */
  it("does not overwrite a category the user picked", () => {
    const patch = settlePatch(entry({ id: "a", categoryId: "cat-mine" }), settled, { at: "x" });
    expect(patch.categoryId).toBeUndefined();
  });

  it("fills in a category when the entry had none", () => {
    const patch = settlePatch(entry({ id: "a" }), settled, { at: "x" });
    expect(patch.categoryId).toBe("cat-market");
  });

  /**
   * The posting date is the one every future statement will use, so the ledger
   * follows it — otherwise the next import fails to recognise this entry.
   */
  it("moves the entry onto the date the bank posted it", () => {
    expect(settlePatch(entry({ id: "a" }), settled, { at: "x" }).date).toBe("2026-08-27");
  });

  it("can be told to keep the day the money was actually spent", () => {
    const patch = settlePatch(entry({ id: "a" }), settled, { at: "x", keepDate: true });
    expect(patch.date).toBeUndefined();
  });

  it("names the card when the entry did not", () => {
    const patch = settlePatch(entry({ id: "a" }), settled, { at: "x", account: "Bonus ••1234" });
    expect(patch.account).toBe("Bonus ••1234");
  });
});
