import { beforeEach, describe, expect, it } from "vitest";
import type { ImportDraft, ImportMerge } from "@/domain/statementImport";
import { useStore } from "@/state/store";

/**
 * Importing the same statement twice, and getting out of it.
 *
 * The undo toast has always reversed an import perfectly, and lasts about as
 * long as it takes to realise you have not made a mistake. The mistake this
 * guards against is the other kind: the file imported twice, noticed the next
 * day when the month's total is read. So the import is a record, and "geri al"
 * still works then — putting back the rows it stamped as carefully as it takes
 * away the rows it made.
 */

const DAY = "2026-08-10";

beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const live = () =>
  useStore.getState().db.transactions.filter((t) => t.deletedAt === null);

const batches = () => useStore.getState().db.statementBatches;

const draft = (over: Partial<ImportDraft> = {}): ImportDraft => ({
  date: DAY,
  amountMinor: 25_000,
  flow: "EXPENSE",
  categoryId: null,
  note: "MIGROS",
  merchant: "Migros",
  externalId: "stmt:2026-08-10:25000:MIGROS:1",
  ...over,
});

describe("importing a statement", () => {
  it("records the import alongside the entries it created", () => {
    useStore.getState().importTransactions([draft()], [], { label: "Agustos" });

    expect(batches()).toHaveLength(1);
    expect(batches()[0]).toMatchObject({
      label: "Agustos",
      createdCount: 1,
      createdMinor: 25_000,
      mode: "rows",
      revertedAt: null,
    });
  });

  it("stamps every entry it created with the import it came from", () => {
    useStore
      .getState()
      .importTransactions(
        [draft(), draft({ externalId: "stmt:b", amountMinor: 4_500 })],
        [],
        { label: "Agustos" },
      );

    const id = batches()[0]!.id;
    expect(live().every((entry) => entry.importId === id)).toBe(true);
  });

  it("takes its date range from the rows when none is given", () => {
    useStore.getState().importTransactions(
      [
        draft({ date: "2026-08-03", externalId: "a" }),
        draft({ date: "2026-08-28", externalId: "b" }),
      ],
      [],
      { label: "Agustos" },
    );

    expect(batches()[0]).toMatchObject({ from: "2026-08-03", to: "2026-08-28" });
  });

  it("writes no batch at all when there was nothing left to import", () => {
    useStore.getState().importTransactions([draft()], [], { label: "Bir" });
    useStore.getState().importTransactions([draft()], [], { label: "Iki" });

    expect(batches()).toHaveLength(1);
    expect(live()).toHaveLength(1);
  });
});

describe("taking an import back", () => {
  const importOnce = (label = "Agustos") => {
    useStore
      .getState()
      .importTransactions(
        [draft(), draft({ externalId: "stmt:b", amountMinor: 4_500 })],
        [],
        { label },
      );
    return batches().at(-1)!.id;
  };

  it("removes the entries it created", () => {
    const id = importOnce();
    expect(live()).toHaveLength(2);

    expect(useStore.getState().revertImport(id)).toBe(2);
    expect(live()).toHaveLength(0);
  });

  it("marks the batch reverted rather than deleting the record", () => {
    const id = importOnce();
    useStore.getState().revertImport(id);

    expect(batches()).toHaveLength(1);
    expect(batches()[0]!.revertedAt).not.toBeNull();
  });

  it("does nothing the second time it is asked", () => {
    const id = importOnce();
    useStore.getState().revertImport(id);

    expect(useStore.getState().revertImport(id)).toBe(0);
  });

  it("leaves a different import's entries standing", () => {
    const first = importOnce("Agustos");
    useStore
      .getState()
      .importTransactions([draft({ externalId: "stmt:c" })], [], {
        label: "Eylul",
      });

    useStore.getState().revertImport(first);

    expect(live()).toHaveLength(1);
    expect(live()[0]!.externalId).toBe("stmt:c");
  });

  it("leaves hand-typed entries alone", () => {
    useStore
      .getState()
      .addTransaction({ date: DAY, amountMinor: 9_900, flow: "EXPENSE", categoryId: null });
    const id = importOnce();

    useStore.getState().revertImport(id);

    expect(live()).toHaveLength(1);
    expect(live()[0]!.amountMinor).toBe(9_900);
  });

  it("skips a created entry the user has already thrown away", () => {
    const id = importOnce();
    const first = live()[0]!;
    useStore.getState().deleteTransaction(first.id);

    expect(useStore.getState().revertImport(id)).toBe(1);
  });

  it("is a soft delete, so the rows are in the trash rather than gone", () => {
    const id = importOnce();
    useStore.getState().revertImport(id);

    expect(useStore.getState().db.transactions).toHaveLength(2);
    expect(
      useStore.getState().db.transactions.every((t) => t.deletedAt !== null),
    ).toBe(true);
  });

  it("does nothing for a batch that does not exist", () => {
    expect(useStore.getState().revertImport("imp_nope")).toBe(0);
  });
});

describe("taking back an import that settled existing entries", () => {
  /** A hand-typed entry the statement later confirms. */
  const setup = () => {
    const typed = useStore
      .getState()
      .addTransaction({ date: DAY, amountMinor: 25_000, flow: "EXPENSE", categoryId: null })!;

    const merge: ImportMerge = {
      entryId: typed.id,
      merchant: "Migros",
      patch: {
        externalId: "stmt:settled",
        merchant: "Migros",
        confirmedAt: "2026-09-01T09:00:00.000Z",
        categoryId: null,
        amountMinor: 25_340,
        origin: "statement",
      },
    };

    useStore.getState().importTransactions([], [merge], { label: "Agustos" });
    return { typedId: typed.id, batchId: batches().at(-1)!.id };
  };

  it("confirms the entry in place rather than adding a second one", () => {
    const { typedId } = setup();

    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({
      id: typedId,
      amountMinor: 25_340,
      merchant: "Migros",
    });
  });

  it("puts the entry back exactly as the user had it", () => {
    const { typedId, batchId } = setup();

    useStore.getState().revertImport(batchId);

    const back = live().find((t) => t.id === typedId)!;
    expect(back).toMatchObject({
      amountMinor: 25_000,
      externalId: null,
      confirmedAt: null,
      merchant: null,
    });
  });

  it("does not resurrect an entry the user threw away afterwards", () => {
    const { typedId, batchId } = setup();
    useStore.getState().deleteTransaction(typedId);

    useStore.getState().revertImport(batchId);

    expect(live()).toHaveLength(0);
  });
});
