import { beforeEach, describe, expect, it } from "vitest";
import { representativeInstance } from "@/domain/task";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * Taking back the click you regret the moment you make it.
 *
 * The reversal always goes through the ordinary store action — undoing a delete
 * is `restoreTask`, the same call the Trash makes — so the activity trail
 * records both the mistake and the correction rather than quietly rewinding to
 * before either happened.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
  useUndoStore.getState().dismiss();
});

const instanceOf = (taskId: string) => {
  const task = useStore.getState().db.tasks.find((t) => t.id === taskId)!;
  return representativeInstance(task, new Map(), new Date());
};

const taskById = (id: string) =>
  useStore.getState().db.tasks.find((t) => t.id === id);

describe("deleting a task", () => {
  it("offers an undo, and the undo brings it back", () => {
    const task = useStore.getState().createTask({ title: "Wrong row" });
    useStore.getState().deleteTask(task.id);

    expect(taskById(task.id)?.deletedAt).not.toBeNull();
    expect(useUndoStore.getState().pending?.label).toBe("undoneTaskDeleted");

    useUndoStore.getState().undo();

    expect(taskById(task.id)?.deletedAt).toBeNull();
  });

  it("records both the delete and the restore in history", () => {
    const task = useStore.getState().createTask({ title: "Wrong row" });
    useStore.getState().deleteTask(task.id);
    useUndoStore.getState().undo();

    const kinds = useStore
      .getState()
      .db.history.filter((h) => h.taskId === task.id)
      .map((h) => h.kind);

    expect(kinds).toContain("DELETED");
    expect(kinds).toContain("RESTORED");
  });
});

describe("completing a task", () => {
  it("goes back to exactly the status it had, not just to TODO", () => {
    const task = useStore.getState().createTask({ title: "In flight" });
    useStore
      .getState()
      .setStatus({ taskId: task.id, occurrenceDate: null }, "IN_PROGRESS");

    useStore.getState().toggleComplete(instanceOf(task.id));
    expect(taskById(task.id)?.status).toBe("COMPLETED");

    useUndoStore.getState().undo();
    expect(taskById(task.id)?.status).toBe("IN_PROGRESS");
  });

  it("can also take back re-opening a completed task", () => {
    const task = useStore.getState().createTask({ title: "Done already" });
    useStore
      .getState()
      .setStatus({ taskId: task.id, occurrenceDate: null }, "COMPLETED");

    useStore.getState().toggleComplete(instanceOf(task.id));
    expect(useUndoStore.getState().pending?.label).toBe("undoneTaskReopened");

    useUndoStore.getState().undo();
    expect(taskById(task.id)?.status).toBe("COMPLETED");
  });
});

describe("rolling work forward", () => {
  it("puts every moved task back on its own original date", () => {
    const a = useStore.getState().createTask({ title: "A", dueDate: "2026-08-19" });
    const b = useStore.getState().createTask({ title: "B", dueDate: "2026-08-20" });

    useStore.getState().rollOverTo([a.id, b.id], "2026-08-25");
    expect(taskById(a.id)?.dueDate).toBe("2026-08-25");

    useUndoStore.getState().undo();

    // Not "back to yesterday" — back to where each one actually was.
    expect(taskById(a.id)?.dueDate).toBe("2026-08-19");
    expect(taskById(b.id)?.dueDate).toBe("2026-08-20");
  });
});

describe("budget", () => {
  it("restores a deleted entry", () => {
    const tx = useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 12_50,
      flow: "EXPENSE",
      categoryId: null,
    });
    useStore.getState().deleteTransaction(tx.id);
    useUndoStore.getState().undo();

    expect(
      useStore.getState().db.transactions.find((t) => t.id === tx.id)?.deletedAt,
    ).toBeNull();
  });

  it("puts a removed category back together with the entries filed under it", () => {
    const category = useStore.getState().ensureBudgetCategory("Kahve", "EXPENSE");
    const tx = useStore.getState().addTransaction({
      date: "2026-08-25",
      amountMinor: 45_00,
      flow: "EXPENSE",
      categoryId: category.id,
    });

    useStore.getState().removeBudgetCategory(category.id);
    expect(
      useStore.getState().db.transactions.find((t) => t.id === tx.id)?.categoryId,
    ).toBeNull();

    useUndoStore.getState().undo();

    // Restoring the label alone would leave the history uncategorised forever.
    expect(
      useStore.getState().db.budgetCategories.some((c) => c.id === category.id),
    ).toBe(true);
    expect(
      useStore.getState().db.transactions.find((t) => t.id === tx.id)?.categoryId,
    ).toBe(category.id);
  });
});

describe("the offer itself", () => {
  it("holds only the most recent action", () => {
    const a = useStore.getState().createTask({ title: "First" });
    const b = useStore.getState().createTask({ title: "Second" });
    useStore.getState().deleteTask(a.id);
    useStore.getState().deleteTask(b.id);

    useUndoStore.getState().undo();

    // One step deep by design: replaying further back over a document that also
    // changes from another device invents a state nobody was ever in.
    expect(taskById(b.id)?.deletedAt).toBeNull();
    expect(taskById(a.id)?.deletedAt).not.toBeNull();
  });

  it("clears itself so the same undo cannot be applied twice", () => {
    const task = useStore.getState().createTask({ title: "Once" });
    useStore.getState().deleteTask(task.id);

    expect(useUndoStore.getState().undo()).toBe(true);
    expect(useUndoStore.getState().undo()).toBe(false);
    expect(useUndoStore.getState().pending).toBeNull();
  });

  it("ignores a stale dismissal aimed at an older offer", () => {
    const a = useStore.getState().createTask({ title: "First" });
    useStore.getState().deleteTask(a.id);
    const staleId = useUndoStore.getState().pending!.id;

    const b = useStore.getState().createTask({ title: "Second" });
    useStore.getState().deleteTask(b.id);

    useUndoStore.getState().dismiss(staleId);

    // The newer offer survives its predecessor's timeout.
    expect(useUndoStore.getState().pending).not.toBeNull();
  });
});
