import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "@/state/selectionStore";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * Acting on several tasks at once.
 *
 * The properties that matter are the ones a loop over single-task actions
 * would get wrong: one undo offer rather than fifty, a subtree counted once
 * when both a plan and its step are picked, and history that still records
 * every task individually — a bulk edit is a shortcut for the user, never a
 * shortcut through the trail.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
  useSelectionStore.getState().clear();
  useUndoStore.getState().dismiss();
});

const live = () => useStore.getState().db.tasks.filter((t) => !t.deletedAt);

const seed = () => {
  const store = useStore.getState();
  const a = store.createTask({ title: "Slaytlar", dueDate: "2026-09-01" });
  const b = store.createTask({ title: "Prova", dueDate: "2026-09-02" });
  const c = store.createTask({ title: "Baskı", dueDate: "2026-09-03" });
  return { a, b, c };
};

describe("the selection", () => {
  it("starts empty and invisible", () => {
    expect(useSelectionStore.getState().ids).toEqual([]);
    expect(useSelectionStore.getState().active).toBe(false);
  });

  it("turns itself on the first time a row is picked", () => {
    useSelectionStore.getState().pick("t1");
    expect(useSelectionStore.getState().active).toBe(true);
    expect(useSelectionStore.getState().ids).toEqual(["t1"]);
  });

  it("unpicks a row that is picked again", () => {
    useSelectionStore.getState().pick("t1");
    useSelectionStore.getState().pick("t1");
    expect(useSelectionStore.getState().ids).toEqual([]);
    // The mode stays on, so correcting a misclick does not start over.
    expect(useSelectionStore.getState().active).toBe(true);
  });

  it("extends across the list a Shift-click was made in", () => {
    const list = ["a", "b", "c", "d"];
    useSelectionStore.getState().pick("a", { listIds: list });
    useSelectionStore.getState().pick("c", { listIds: list, range: true });
    expect(useSelectionStore.getState().ids).toEqual(["a", "b", "c"]);
  });

  it("extends backwards just as happily", () => {
    const list = ["a", "b", "c", "d"];
    useSelectionStore.getState().pick("d", { listIds: list });
    useSelectionStore.getState().pick("b", { listIds: list, range: true });
    expect(useSelectionStore.getState().ids).toEqual(["d", "b", "c"]);
  });

  it("adds a range to what was already held rather than replacing it", () => {
    const list = ["a", "b", "c", "d"];
    useSelectionStore.getState().pick("d", { listIds: list });
    useSelectionStore.getState().pick("a", { listIds: list });
    useSelectionStore.getState().pick("b", { listIds: list, range: true });
    expect(useSelectionStore.getState().ids).toEqual(["d", "a", "b"]);
  });

  it("falls back to a plain toggle when the row is not in the list given", () => {
    useSelectionStore.getState().pick("a", { listIds: ["a", "b"] });
    // A row from another list: there is no range between the two.
    useSelectionStore.getState().pick("z", { listIds: ["a", "b"], range: true });
    expect(useSelectionStore.getState().ids).toEqual(["a", "z"]);
  });

  it("clears back to invisible", () => {
    useSelectionStore.getState().pick("a");
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().ids).toEqual([]);
    expect(useSelectionStore.getState().active).toBe(false);
  });
});

describe("bulkSetStatus", () => {
  it("completes every task it is given", () => {
    const { a, b, c } = seed();
    useStore.getState().bulkSetStatus([a.id, b.id], "COMPLETED");

    const byId = new Map(live().map((task) => [task.id, task]));
    expect(byId.get(a.id)?.status).toBe("COMPLETED");
    expect(byId.get(b.id)?.status).toBe("COMPLETED");
    expect(byId.get(c.id)?.status).toBe("TODO");
  });

  it("reopens them again", () => {
    const { a, b } = seed();
    useStore.getState().bulkSetStatus([a.id, b.id], "COMPLETED");
    useStore.getState().bulkSetStatus([a.id, b.id], "TODO");

    expect(live().every((task) => task.status === "TODO")).toBe(true);
  });

  it("leaves a history entry per task, not one for the batch", () => {
    const { a, b } = seed();
    useStore.getState().bulkSetStatus([a.id, b.id], "COMPLETED");

    const changes = useStore
      .getState()
      .db.history.filter((entry) => entry.kind === "STATUS_CHANGED");
    expect(changes.map((entry) => entry.taskId).sort()).toEqual([a.id, b.id].sort());
  });

  it("does nothing at all when handed nothing", () => {
    seed();
    const before = useStore.getState().db.history.length;
    useStore.getState().bulkSetStatus([], "COMPLETED");
    expect(useStore.getState().db.history).toHaveLength(before);
  });

  it("completes the occurrence of a repeating task, not the task row", () => {
    // `toInstance` reads a repeating task's status from its occurrence and
    // ignores `task.status`, so writing the task row would tick nothing.
    const repeating = useStore.getState().createTask({
      title: "Haftalık rapor",
      dueDate: "2026-09-01",
      recurrence: { freq: "WEEKLY", interval: 1 },
    });

    useStore.getState().bulkSetStatus([repeating.id], "COMPLETED");

    const { db } = useStore.getState();
    expect(db.tasks.find((t) => t.id === repeating.id)?.status).toBe("TODO");
    expect(db.occurrences.map((o) => [o.taskId, o.status])).toEqual([
      [repeating.id, "COMPLETED"],
    ]);
  });
});

describe("bulkUpdateTasks", () => {
  it("applies one edit across the batch", () => {
    const { a, b } = seed();
    useStore.getState().bulkUpdateTasks([a.id, b.id], { priority: "HIGH" });

    expect(live().filter((task) => task.priority === "HIGH")).toHaveLength(2);
  });

  it("reschedules the batch onto one day", () => {
    const { a, b, c } = seed();
    useStore
      .getState()
      .bulkUpdateTasks([a.id, b.id, c.id], { dueDate: "2026-09-10", allDay: true });

    expect(live().map((task) => task.dueDate)).toEqual([
      "2026-09-10",
      "2026-09-10",
      "2026-09-10",
    ]);
  });

  it("carries a category down to subtasks, exactly as a single edit does", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Sunum" });
    const step = store.createTask({ title: "Slaytlar", parentId: plan.id });
    const category = useStore.getState().db.categories[0];
    expect(category).toBeDefined();

    useStore.getState().bulkUpdateTasks([plan.id], { categoryId: category!.id });

    const moved = useStore.getState().db.tasks.find((task) => task.id === step.id);
    expect(moved?.categoryId).toBe(category!.id);
  });
});

describe("bulkDeleteTasks", () => {
  it("trashes everything picked", () => {
    const { a, b, c } = seed();
    useStore.getState().bulkDeleteTasks([a.id, b.id]);

    expect(live().map((task) => task.id)).toEqual([c.id]);
  });

  it("takes the subtasks with it", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Sunum" });
    useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });

    useStore.getState().bulkDeleteTasks([plan.id]);

    expect(live()).toHaveLength(0);
  });

  it("counts a task once when its parent was picked as well", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Sunum" });
    const step = useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });

    useStore.getState().bulkDeleteTasks([plan.id, step.id]);

    const deletions = useStore
      .getState()
      .db.history.filter((entry) => entry.kind === "DELETED" && entry.taskId === step.id);
    expect(deletions).toHaveLength(1);
  });

  it("offers a single undo that brings the whole batch back", () => {
    const { a, b, c } = seed();
    useStore.getState().bulkDeleteTasks([a.id, b.id]);
    expect(live().map((task) => task.id)).toEqual([c.id]);

    const pending = useUndoStore.getState().pending;
    expect(pending?.label).toBe("undoneTasksDeleted");

    useUndoStore.getState().undo();
    expect(live().map((task) => task.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("does nothing at all when handed nothing", () => {
    seed();
    useStore.getState().bulkDeleteTasks([]);
    expect(live()).toHaveLength(3);
    expect(useUndoStore.getState().pending).toBeNull();
  });
});
