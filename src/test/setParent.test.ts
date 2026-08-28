import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";

/**
 * Filing an existing task under a plan.
 *
 * The invariants that matter are the ones a plain `updateTask({ parentId })`
 * could not have kept: the tree stays a tree, and the moved row does not land
 * on an `order` one of its new siblings already holds.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const find = (id: string) => useStore.getState().db.tasks.find((t) => t.id === id)!;

describe("setParent", () => {
  it("files a loose task under a plan, last among its siblings", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Taşınma", tags: ["plan"] });
    useStore.getState().createTask({ title: "Kutu al", parentId: plan.id });
    const loose = useStore.getState().createTask({ title: "Kamyonet ayarla" });

    useStore.getState().setParent(loose.id, plan.id);

    expect(find(loose.id).parentId).toBe(plan.id);
    expect(find(loose.id).order).toBe(1);
  });

  it("drops the pin the task carried in the list it left", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Taşınma", tags: ["plan"] });
    const loose = useStore.getState().createTask({ title: "Kamyonet ayarla" });
    useStore.getState().reorderTasks([loose.id], loose.id);
    expect(find(loose.id).manualOrder).toBe(0);

    useStore.getState().setParent(loose.id, plan.id);

    expect(find(loose.id).manualOrder).toBe(null);
  });

  it("refuses to file a task under its own descendant", () => {
    const store = useStore.getState();
    const root = store.createTask({ title: "Taşınma" });
    const child = useStore
      .getState()
      .createTask({ title: "Kutular", parentId: root.id });

    useStore.getState().setParent(root.id, child.id);

    expect(find(root.id).parentId).toBe(null);
  });

  it("refuses to file a task under itself", () => {
    const root = useStore.getState().createTask({ title: "Taşınma" });
    useStore.getState().setParent(root.id, root.id);
    expect(find(root.id).parentId).toBe(null);
  });

  it("sets a subtask loose again", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Taşınma", tags: ["plan"] });
    const child = useStore
      .getState()
      .createTask({ title: "Kutular", parentId: plan.id });

    useStore.getState().setParent(child.id, null);

    expect(find(child.id).parentId).toBe(null);
  });

  it("records the move in the task's own history", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Taşınma", tags: ["plan"] });
    const loose = useStore.getState().createTask({ title: "Kamyonet ayarla" });

    useStore.getState().setParent(loose.id, plan.id);

    const notes = useStore
      .getState()
      .db.history.filter((h) => h.taskId === loose.id)
      .map((h) => h.note);
    expect(notes).toContain('Filed under "Taşınma"');
  });
});
