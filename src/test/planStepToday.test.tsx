import { act } from "react";
import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/domain/types";
import { EMPTY_FILTERS, useTodoGroups } from "@/state/selectors";
import { useStore } from "@/state/store";
import { SubtaskList } from "@/ui/task/SubtaskList";

/**
 * A plan's steps can be put on today from inside the task, at any depth.
 *
 * The plan card already carried the control for the steps directly under a
 * plan. Two things kept it from reaching a step's *own* steps: the panel's
 * subtask list had no such button at all, and `useTodoGroups` asked whether
 * the direct parent was tagged `plan` — so a second-level step could be given
 * a date that then showed up in no view, which reads as the app dropping the
 * edit. Both now ask `enclosingPlan`, which walks the whole chain.
 */
const TUESDAY = "2026-08-25";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TUESDAY}T09:00:00`));
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

const taskOf = (taskId: string): Task => {
  const task = useStore.getState().db.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  return task;
};

const dueDateOf = (taskId: string) => taskOf(taskId).dueDate;

const todayTitles = () => {
  const { result } = renderHook(() => useTodoGroups(EMPTY_FILTERS));
  return (
    result.current
      .find((g) => g.id === "today")
      ?.instances.map((i) => i.task.title) ?? []
  );
};

/** plan → step → leaf, the shape the direct-parent check could not see. */
function nestedPlan() {
  const plan = useStore
    .getState()
    .createTask({ title: "Sunum", tags: ["plan"] });
  const step = useStore
    .getState()
    .createTask({ title: "Slaytlar", parentId: plan.id, dueDate: null });
  const leaf = useStore
    .getState()
    .createTask({ title: "Kapak tasarımı", parentId: step.id, dueDate: null });
  return { plan, step, leaf };
}

describe("the today button on a panel's subtask row", () => {
  it("reaches a step's own steps, not just a plan's", () => {
    const { step, leaf } = nestedPlan();

    render(<SubtaskList parent={taskOf(step.id)} onOpen={() => undefined} />);
    act(() => {
      screen.getByTitle("Bugüne Ata").click();
    });

    expect(dueDateOf(leaf.id)).toBe(TUESDAY);
    expect(taskOf(leaf.id).allDay).toBe(true);
  });

  it("puts that nested step in today's list", () => {
    const { leaf } = nestedPlan();

    expect(todayTitles()).not.toContain("Kapak tasarımı");
    act(() => {
      useStore.getState().updateTask(leaf.id, { dueDate: TUESDAY, allDay: true });
    });

    expect(todayTitles()).toContain("Kapak tasarımı");
  });

  it("takes it back off today without detaching it from the plan", () => {
    const { step, leaf } = nestedPlan();
    useStore.getState().updateTask(leaf.id, { dueDate: TUESDAY, allDay: true });

    render(<SubtaskList parent={taskOf(step.id)} onOpen={() => undefined} />);
    act(() => {
      screen.getByTitle("Bugünden / Görevlerden Kaldır (Planda kalır)").click();
    });

    expect(dueDateOf(leaf.id)).toBeNull();
    expect(taskOf(leaf.id).parentId).toBe(step.id);
    expect(useStore.getState().db.tasks.filter((t) => !t.deletedAt)).toHaveLength(3);
  });

  it("dates a plan's direct step too", () => {
    const { plan, step } = nestedPlan();

    render(<SubtaskList parent={taskOf(plan.id)} onOpen={() => undefined} />);
    act(() => {
      screen.getByTitle("Bugüne Ata").click();
    });

    expect(dueDateOf(step.id)).toBe(TUESDAY);
  });

  it("is not offered outside a plan, where the date would surface nowhere", () => {
    const task = useStore.getState().createTask({ title: "Tek görev" });
    const sub = useStore
      .getState()
      .createTask({ title: "Adım", parentId: task.id, dueDate: null });

    render(<SubtaskList parent={taskOf(task.id)} onOpen={() => undefined} />);
    expect(screen.queryByTitle("Bugüne Ata")).toBeNull();

    // …and the rule the button follows still holds for the list itself.
    act(() => {
      useStore.getState().updateTask(sub.id, { dueDate: TUESDAY });
    });
    expect(todayTitles()).not.toContain("Adım");
  });
});
