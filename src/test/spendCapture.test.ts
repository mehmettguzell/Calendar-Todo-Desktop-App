import { beforeEach, describe, expect, it } from "vitest";
import { isProvisional } from "@/domain/money";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * One purchase, one record — across both ways of hearing about it.
 *
 * This is the spending side of the app's central rule. A purchase can reach the
 * ledger typed at the till and printed on the statement weeks later; the two
 * must converge on a single row. These tests are written against the store
 * rather than the pure functions because the failure this guards against is a
 * *write* happening twice.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const live = () =>
  useStore.getState().db.transactions.filter((t) => t.deletedAt === null);

describe("what the statement settles", () => {
  const settle = (entryId: string, externalId = "stmt:2026-08-27:25000:MIGROS:1") =>
    useStore.getState().importTransactions(
      [],
      [
        {
          entryId,
          merchant: "Migros",
          patch: {
            externalId,
            merchant: "Migros",
            date: "2026-08-27",
            confirmedAt: "2026-09-05T00:00:00.000Z",
            origin: "manual",
          },
        },
      ],
    );

  it("confirms the entry in place rather than adding a second one", () => {
    const entry = useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 25_000,
      flow: "EXPENSE",
      categoryId: null,
      note: "migros",
    });

    expect(settle(entry.id)).toBe(1);

    const rows = live();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-08-27");
    expect(rows[0]?.confirmedAt).toBe("2026-09-05T00:00:00.000Z");
    expect(isProvisional(rows[0]!)).toBe(false);
  });

  /**
   * A merge edits a row the user wrote. An undo that left the bank's merchant,
   * date and fingerprint behind would not be an undo.
   */
  it("can be undone back to exactly what the user had", () => {
    const entry = useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 25_000,
      flow: "EXPENSE",
      categoryId: null,
      note: "migros",
    });
    settle(entry.id);

    useUndoStore.getState().undo();

    const rows = live();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-08-25");
    expect(rows[0]?.externalId ?? null).toBeNull();
    expect(rows[0]?.confirmedAt ?? null).toBeNull();
  });

  it("skips a merge whose fingerprint is already in the ledger", () => {
    const entry = useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 25_000,
      flow: "EXPENSE",
      categoryId: null,
      note: "migros",
    });
    const second = useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 25_000,
      flow: "EXPENSE",
      categoryId: null,
      note: "migros again",
    });

    settle(entry.id);
    // The same statement row cannot then settle a different entry as well.
    expect(settle(second.id)).toBe(0);
    expect(live().filter((row) => row.confirmedAt)).toHaveLength(1);
  });

});

describe("the day's prompt", () => {
  it("is marked answered for the day it was raised", () => {
    useStore.getState().markSpendNudged("2026-08-25");
    expect(useStore.getState().db.settings.lastSpendNudgeOn).toBe("2026-08-25");
  });
});
