import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";

/**
 * A subtask belongs to whatever its parent belongs to. The rule has three
 * entry points — creating a subtask, re-filing a task under a plan, and
 * changing a plan's own category — and all three have to agree, or the Plans
 * view and the category filters start disagreeing about the same task.
 *
 * Priority inherits down the same two of those paths, for the same reason and
 * with one difference: a priority the task already carries is somebody's
 * answer, so it is never overwritten. `NONE` is the absence of an answer.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const store = () => useStore.getState();
const categoryOf = (id: string) =>
  useStore.getState().db.tasks.find((t) => t.id === id)?.categoryId ?? null;
const priorityOf = (id: string) =>
  useStore.getState().db.tasks.find((t) => t.id === id)?.priority ?? null;

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

/**
 * How urgent a step is, is how urgent the thing it is a step of is.
 *
 * Every box that adds a step is a single line with no priority field on it, so
 * steps were all born NONE. Put on today, a step of an urgent plan then
 * arrived in the list looking like the least pressing thing on it — and there
 * was nowhere in that flow to say otherwise.
 */
describe("a step's priority", () => {
  const urgentPlan = () =>
    store().createTask({ title: "Tez", tags: ["plan"], priority: "HIGH" });

  it("starts at its plan's", () => {
    const plan = urgentPlan();
    const step = store().createTask({ title: "Kaynak taraması", parentId: plan.id });
    expect(priorityOf(step.id)).toBe("HIGH");
  });

  it("reaches a step's own steps", () => {
    const plan = urgentPlan();
    const step = store().createTask({ title: "Kaynak taraması", parentId: plan.id });
    const leaf = store().createTask({ title: "Kapak", parentId: step.id });
    expect(priorityOf(leaf.id)).toBe("HIGH");
  });

  it("keeps one it was given explicitly", () => {
    const plan = urgentPlan();
    const step = store().createTask({
      title: "Kaynak taraması",
      parentId: plan.id,
      priority: "LOW",
    });
    expect(priorityOf(step.id)).toBe("LOW");
  });

  it("stays NONE under a plan that claims nothing", () => {
    const plan = store().createTask({ title: "Tez", tags: ["plan"] });
    const step = store().createTask({ title: "Adım", parentId: plan.id });
    expect(priorityOf(step.id)).toBe("NONE");
  });

  it("is adopted when a loose task is filed under the plan", () => {
    const plan = urgentPlan();
    const loose = store().createTask({ title: "Makale oku" });

    store().setParent(loose.id, plan.id);

    expect(priorityOf(loose.id)).toBe("HIGH");
  });

  it("is left alone when the task already has one of its own", () => {
    const plan = urgentPlan();
    const loose = store().createTask({ title: "Makale oku", priority: "LOW" });

    store().setParent(loose.id, plan.id);

    expect(priorityOf(loose.id)).toBe("LOW");
  });
});
