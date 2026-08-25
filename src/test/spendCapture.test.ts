import { beforeEach, describe, expect, it } from "vitest";
import type { BankAlert } from "@/domain/bankAlert";
import { isProvisional, originOf } from "@/domain/money";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * One purchase, one record — across all three ways of hearing about it.
 *
 * This is the spending side of the app's central rule. A purchase can reach the
 * ledger typed at the till, pushed by the bank's notification mail, and printed
 * on the statement weeks later; the three must converge on a single row. These
 * tests are written against the store rather than the pure functions because
 * the failure this guards against is a *write* happening twice.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const live = () =>
  useStore.getState().db.transactions.filter((t) => t.deletedAt === null);

function alert(partial: Partial<BankAlert> & { externalId: string }): BankAlert {
  return {
    bank: "garanti",
    date: "2026-08-25",
    amountMinor: 25_000,
    currency: "TRY",
    flow: "EXPENSE",
    kind: "spend",
    description: "MIGROS TIC.A.S.",
    cardLast4: "1234",
    account: "Bonus ••1234",
    hints: [],
    ...partial,
  };
}

describe("what the bank pushes", () => {
  it("becomes an entry, filed under the shop's category", () => {
    expect(useStore.getState().recordBankAlerts([alert({ externalId: "alert:1" })])).toBe(1);

    const [entry] = live();
    expect(entry?.amountMinor).toBe(25_000);
    expect(entry?.merchant).toBe("Migros");
    expect(entry?.account).toBe("Bonus ••1234");
    expect(entry?.categoryId).not.toBeNull();
    expect(originOf(entry!)).toBe("alert");
  });

  /**
   * An entry the bank has only announced is not an entry the bank has charged.
   * Instalments, tips and currency conversion all settle at a different figure.
   */
  it("is provisional until a statement says otherwise", () => {
    useStore.getState().recordBankAlerts([alert({ externalId: "alert:1" })]);
    expect(isProvisional(live()[0]!)).toBe(true);
  });

  it("cannot be recorded twice, however often the mailbox is re-read", () => {
    const twice = [alert({ externalId: "alert:1" })];
    useStore.getState().recordBankAlerts(twice);
    expect(useStore.getState().recordBankAlerts(twice)).toBe(0);
    expect(live()).toHaveLength(1);
  });

  /**
   * The case the whole reconciler exists for: someone logs the purchase at the
   * till, and the bank's mail lands two minutes later. That is one purchase.
   */
  it("settles a purchase the user typed at the till instead of repeating it", () => {
    useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 25_000,
      flow: "EXPENSE",
      categoryId: null,
      note: "migros",
    });

    expect(useStore.getState().recordBankAlerts([alert({ externalId: "alert:1" })])).toBe(0);

    const rows = live();
    expect(rows).toHaveLength(1);
    // The user's own entry, now taught the shop and the card by the bank.
    expect(originOf(rows[0]!)).toBe("manual");
    expect(rows[0]?.account).toBe("Bonus ••1234");
    expect(rows[0]?.externalId).toBe("alert:1");
    expect(isProvisional(rows[0]!)).toBe(true);
  });

  it("keeps two genuinely different purchases apart", () => {
    useStore
      .getState()
      .recordBankAlerts([
        alert({ externalId: "alert:1" }),
        alert({ externalId: "alert:2", amountMinor: 25_001 }),
      ]);
    expect(live()).toHaveLength(2);
  });

  /**
   * The movement that clears the card is not a purchase; counting it would
   * double every purchase it settled.
   */
  it("ignores a card payment", () => {
    expect(
      useStore.getState().recordBankAlerts([alert({ externalId: "alert:1", kind: "payment" })]),
    ).toBe(0);
    expect(live()).toHaveLength(0);
  });

  it("records a refund as money coming back", () => {
    useStore
      .getState()
      .recordBankAlerts([
        alert({ externalId: "alert:1", flow: "INCOME", kind: "refund" }),
      ]);
    expect(live()[0]?.flow).toBe("INCOME");
  });
});

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

  /**
   * Once a statement has settled an entry, the notification mail that started
   * it must not be able to file it again.
   */
  it("leaves a settled entry out of reach of a later alert", () => {
    useStore.getState().recordBankAlerts([alert({ externalId: "alert:1" })]);
    const entry = live()[0]!;
    settle(entry.id);

    expect(
      useStore.getState().recordBankAlerts([alert({ externalId: "alert:2" })]),
    ).toBe(1);
    expect(live()).toHaveLength(2);
  });
});

describe("the day's prompt", () => {
  it("is marked answered for the day it was raised", () => {
    useStore.getState().markSpendNudged("2026-08-25");
    expect(useStore.getState().db.settings.lastSpendNudgeOn).toBe("2026-08-25");
  });
});
