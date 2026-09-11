import { describe, expect, it } from "vitest";
import { migrate } from "@/data/db";
import type { Transaction } from "@/domain/money";

/**
 * Imports that happened before imports were recorded.
 *
 * "Undo this statement" hangs off a batch record, and a document written before
 * that record existed has none — so the one import somebody most wants back,
 * the duplicate they made last week, is exactly the one the list could not
 * offer. Every row a statement wrote carries the instant of the import that
 * wrote it, and one import stamps them all with the same instant, so the groups
 * are exact rather than guessed.
 */

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "x",
  date: "2026-08-10",
  amountMinor: 10_000,
  flow: "EXPENSE",
  categoryId: null,
  note: "",
  recurrence: null,
  recurrenceSourceId: null,
  lastGeneratedFor: null,
  createdAt: "2026-08-29T13:08:45.267Z",
  updatedAt: "2026-08-29T13:08:45.267Z",
  deletedAt: null,
  ...over,
});

const run = (transactions: Transaction[], statementBatches: unknown[] = []) =>
  migrate({ transactions, statementBatches });

describe("recovering a past import", () => {
  it("groups the rows one import wrote into one batch", () => {
    const db = run([
      tx({ id: "a", externalId: "stmt:1", date: "2026-08-03" }),
      tx({ id: "b", externalId: "stmt:2", date: "2026-08-20" }),
    ]);

    expect(db.statementBatches).toHaveLength(1);
    expect(db.statementBatches[0]).toMatchObject({
      createdCount: 2,
      createdMinor: 20_000,
      from: "2026-08-03",
      to: "2026-08-20",
      revertedAt: null,
    });
  });

  it("keeps two imports apart by the instant each one wrote", () => {
    const db = run([
      tx({ id: "a", externalId: "stmt:1" }),
      tx({ id: "b", externalId: "stmt:2", createdAt: "2026-09-01T22:11:09.345Z" }),
    ]);

    expect(db.statementBatches).toHaveLength(2);
    expect(db.statementBatches.map((b) => b.createdCount)).toEqual([1, 1]);
  });

  it("links every row back to the batch it belongs to", () => {
    const db = run([
      tx({ id: "a", externalId: "stmt:1" }),
      tx({ id: "b", externalId: "stmt:2" }),
    ]);

    const id = db.statementBatches[0]!.id;
    expect(db.transactions.map((t) => t.importId)).toEqual([id, id]);
  });

  it("leaves hand-typed entries out of it", () => {
    const db = run([tx({ id: "a" }), tx({ id: "b", externalId: "stmt:1" })]);

    expect(db.statementBatches[0]!.createdCount).toBe(1);
    expect(db.transactions.find((t) => t.id === "a")!.importId).toBeNull();
  });

  it("leaves entries thrown away by hand out of the count", () => {
    const db = run([
      tx({ id: "a", externalId: "stmt:1" }),
      tx({ id: "b", externalId: "stmt:2", deletedAt: "2026-08-30T00:00:00.000Z" }),
    ]);

    expect(db.statementBatches[0]!.createdCount).toBe(1);
    expect(db.transactions.find((t) => t.id === "b")!.importId).toBeNull();
  });

  it("runs once — a second load finds nothing left to recover", () => {
    const first = run([tx({ id: "a", externalId: "stmt:1" })]);
    const second = migrate(first);

    expect(second.statementBatches).toHaveLength(1);
    expect(second.statementBatches[0]!.id).toBe(first.statementBatches[0]!.id);
  });

  it("does not touch batches the document already has", () => {
    const existing = {
      id: "imp1",
      label: "Var olan",
      account: null,
      importedAt: "2026-07-01T00:00:00.000Z",
      from: "2026-07-01",
      to: "2026-07-31",
      mode: "rows",
      createdCount: 5,
      createdMinor: 50_000,
      settled: [],
      revertedAt: null,
      deletedAt: null,
    };

    const db = run([tx({ id: "a", externalId: "stmt:1", importId: "imp1" })], [
      existing,
    ]);

    expect(db.statementBatches).toHaveLength(1);
    expect(db.statementBatches[0]!.label).toBe("Var olan");
  });

  it("is labelled with the day it was loaded, which the period line is not", () => {
    const db = run([tx({ id: "a", externalId: "stmt:1", date: "2026-08-03" })]);

    expect(db.statementBatches[0]!.label).toBe("2026-08-29");
    expect(db.statementBatches[0]!.from).toBe("2026-08-03");
  });

  it("names the card only when every row agrees on it", () => {
    const mixed = run([
      tx({ id: "a", externalId: "stmt:1", account: "Bonus" }),
      tx({ id: "b", externalId: "stmt:2", account: "World" }),
    ]);
    const agreed = run([
      tx({ id: "a", externalId: "stmt:1", account: "Bonus" }),
      tx({ id: "b", externalId: "stmt:2", account: "Bonus" }),
    ]);

    expect(mixed.statementBatches[0]!.account).toBeNull();
    expect(agreed.statementBatches[0]!.account).toBe("Bonus");
  });

  it("recognises a daily top-up import for what it was", () => {
    const db = run([
      tx({ id: "a", externalId: "stmt-daily:2026-08-10:25000:20000" }),
    ]);

    expect(db.statementBatches[0]!.mode).toBe("daily");
  });

  it("writes no batch at all for a document with no imports", () => {
    expect(run([tx({ id: "a" })]).statementBatches).toEqual([]);
  });
});
