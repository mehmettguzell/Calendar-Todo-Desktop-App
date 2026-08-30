import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";

/**
 * A subtask belongs to whatever its parent belongs to. The rule has three
 * entry points — creating a subtask, re-filing a task under a plan, and
 * changing a plan's own category — and all three have to agree, or the Plans
 * view and the category filters start disagreeing about the same task.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const store = () => useStore.getState();
const categoryOf = (id: string) =>
  useStore.getState().db.tasks.find((t) => t.id === id)?.categoryId ?? null;

const setup = () => {
  const work = store().addCategory("Tez", "#6366f1");
  const other = store().addCategory("Ev", "#22c55e");
  const plan = store().createTask({ title: "Tez", tags: ["plan"], categoryId: work.id });
  return { work, other, plan };
};

describe("a new subtask", () => {
  it("starts in its parent's category", () => {
    const { work, plan } = setup();
    const step = store().createTask({ title: "Kaynak taramasi", parentId: plan.id });
    expect(categoryOf(step.id)).toBe(work.id);
  });

  it("keeps a category it was given explicitly", () => {
    const { other, plan } = setup();
    const step = store().createTask({
      title: "Kaynak taramasi",
      parentId: plan.id,
      categoryId: other.id,
    });
    expect(categoryOf(step.id)).toBe(other.id);
  });

  it("stays uncategorised under an uncategorised parent", () => {
    const plan = store().createTask({ title: "Plansiz", tags: ["plan"] });
    const step = store().createTask({ title: "Adim", parentId: plan.id });
    expect(categoryOf(step.id)).toBeNull();
  });
});

describe("filing an existing task under a plan", () => {
  it("moves it into the plan's category", () => {
    const { work, other, plan } = setup();
    const loose = store().createTask({ title: "Makale oku", categoryId: other.id });

    store().setParent(loose.id, plan.id);

    expect(categoryOf(loose.id)).toBe(work.id);
  });

  it("brings the task's own subtasks with it", () => {
    const { work, other, plan } = setup();
    const loose = store().createTask({ title: "Makale oku", categoryId: other.id });
    const child = store().createTask({ title: "Not al", parentId: loose.id });

    store().setParent(loose.id, plan.id);

    expect(categoryOf(child.id)).toBe(work.id);
  });

  /*
   * A plan with no category claims nothing: clearing the task's own category
   * would throw information away to express nothing at all.
   */
  it("leaves the category alone when the plan has none", () => {
    const { other } = setup();
    const bare = store().createTask({ title: "Kategorisiz plan", tags: ["plan"] });
    const loose = store().createTask({ title: "Makale oku", categoryId: other.id });

    store().setParent(loose.id, bare.id);

    expect(categoryOf(loose.id)).toBe(other.id);
  });

  it("does not touch the category when a task is detached", () => {
    const { work, plan } = setup();
    const step = store().createTask({ title: "Adim", parentId: plan.id });

    store().setParent(step.id, null);

    expect(categoryOf(step.id)).toBe(work.id);
  });
});

describe("re-filing a plan", () => {
  it("takes every task beneath it along", () => {
    const { other, plan } = setup();
    const step = store().createTask({ title: "Adim", parentId: plan.id });
    const grandchild = store().createTask({ title: "Alt adim", parentId: step.id });

    store().updateTask(plan.id, { categoryId: other.id });

    expect(categoryOf(plan.id)).toBe(other.id);
    expect(categoryOf(step.id)).toBe(other.id);
    expect(categoryOf(grandchild.id)).toBe(other.id);
  });

  it("records the move for each task it touched", () => {
    const { other, plan } = setup();
    const step = store().createTask({ title: "Adim", parentId: plan.id });

    store().updateTask(plan.id, { categoryId: other.id });

    const trail = useStore
      .getState()
      .db.history.filter((h) => h.taskId === step.id && h.field === "categoryId");
    expect(trail).toHaveLength(1);
  });

  it("leaves other tasks alone", () => {
    const { other, plan } = setup();
    const unrelated = store().createTask({ title: "Baska is" });

    store().updateTask(plan.id, { categoryId: other.id });

    expect(categoryOf(unrelated.id)).toBeNull();
  });

  it("does not stamp a subtree that already agrees", () => {
    const { work, plan } = setup();
    const step = store().createTask({ title: "Adim", parentId: plan.id });
    const before = useStore.getState().db.tasks.find((t) => t.id === step.id)?.updatedAt;

    // Same category it already has: nothing should move.
    store().updateTask(plan.id, { categoryId: work.id });

    expect(useStore.getState().db.tasks.find((t) => t.id === step.id)?.updatedAt).toBe(before);
  });
});
