import { beforeEach, describe, expect, it } from "vitest";
import { plansAcceptingTask } from "@/domain/task";
import { useStore } from "@/state/store";

/**
 * Moving a task out of a list and into the plans.
 *
 * Both directions are one store call, because the two rules a plan has to obey
 * — top-level, and no schedule of its own — are easy to half-apply from a view.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const find = (id: string) =>
  useStore.getState().db.tasks.find((t) => t.id === id)!;
const live = () =>
  useStore.getState().db.tasks.filter((t) => t.deletedAt === null);

describe("makePlan", () => {
  it("tags the task and drops the schedule a plan must not carry", () => {
    const task = useStore.getState().createTask({
      title: "Sunum",
      dueDate: "2026-09-01",
      allDay: false,
      startTime: "14:00",
      endTime: "16:00",
    });

    useStore.getState().makePlan(task.id);

    const plan = find(task.id);
    expect(plan.tags).toContain("plan");
    expect(plan.dueDate).toBe(null);
    expect(plan.startTime).toBe(null);
    expect(plan.endTime).toBe(null);
    expect(plan.allDay).toBe(true);
  });

  it("lifts a subtask out of its parent, since a plan is top-level", () => {
    const store = useStore.getState();
    const parent = store.createTask({ title: "Taşınma" });
    const child = useStore
      .getState()
      .createTask({ title: "Kutular", parentId: parent.id });

    useStore.getState().makePlan(child.id);

    expect(find(child.id).parentId).toBe(null);
    expect(find(child.id).tags).toContain("plan");
  });

  it("leaves a task that is already a plan alone", () => {
    const plan = useStore
      .getState()
      .createTask({ title: "Taşınma", tags: ["plan"] });
    const before = find(plan.id).updatedAt;

    useStore.getState().makePlan(plan.id);

    expect(find(plan.id)).toEqual({ ...find(plan.id), updatedAt: before });
    expect(find(plan.id).tags.filter((tag) => tag === "plan")).toHaveLength(1);
  });
});

describe("plansAcceptingTask", () => {
  it("offers the plans a task could move into", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Taşınma", tags: ["plan"] });
    const loose = useStore.getState().createTask({ title: "Kamyonet" });

    expect(
      plansAcceptingTask(live(), find(loose.id)).map((p) => p.id),
    ).toEqual([plan.id]);
  });

  it("does not offer the plan the task already sits in", () => {
    const store = useStore.getState();
    const plan = store.createTask({ title: "Taşınma", tags: ["plan"] });
    const child = useStore
      .getState()
      .createTask({ title: "Kutular", parentId: plan.id });

    expect(plansAcceptingTask(live(), find(child.id))).toEqual([]);
  });

  it("does not offer a plan that lives below the task itself", () => {
    const store = useStore.getState();
    const root = store.createTask({ title: "Taşınma" });
    useStore
      .getState()
      .createTask({ title: "Alt plan", parentId: root.id, tags: ["plan"] });

    // The nested one is not top-level, so it is no plan at all — and moving the
    // root under its own child is exactly what must never be offered.
    expect(plansAcceptingTask(live(), find(root.id))).toEqual([]);
  });
});
