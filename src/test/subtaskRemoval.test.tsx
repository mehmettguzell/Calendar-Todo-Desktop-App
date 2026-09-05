import { act } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { representativeInstance } from "@/domain/task";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";
import { TaskRow } from "@/ui/task/TaskRow";

/**
 * The bin on a subtask row unschedules; the one on a task row deletes.
 *
 * Neither stops to ask on a leaf — clearing steps off today is the most
 * repeated act in the list. What has to hold instead is that the unschedule
 * really is an unschedule (the step stays in its plan) and that it can be
 * taken back from the undo toast. Which deletes ask is `deleteConfirmation`.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

let asked: string[] = [];
let answer = true;

beforeEach(() => {
  asked = [];
  answer = true;
  vi.stubGlobal("confirm", (message: string) => {
    asked.push(message);
    return answer;
  });
});

afterEach(() => vi.unstubAllGlobals());

const today = "2026-09-01";

function mountRow(taskId: string) {
  const { db, now } = useStore.getState();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const instance = representativeInstance(task, new Map(), new Date(now));
  render(<TaskRow instance={instance} onOpen={() => undefined} />);
}

const dueDateOf = (taskId: string) =>
  useStore.getState().db.tasks.find((t) => t.id === taskId)?.dueDate ?? null;

const live = () => useStore.getState().db.tasks.filter((t) => !t.deletedAt);

/**
 * Both destructive controls moved into the row's overflow menu, so reaching
 * them is now two presses. The behaviour behind them is unchanged, and that is
 * exactly what these tests are here to keep true.
 */
const openRowMenu = () =>
  act(() => {
    screen.getByTitle("Diğer eylemler").click();
  });

const removeStep = () => {
  openRowMenu();
  act(() => {
    screen.getByText("Listeden / Tarihten Kaldır (Planda kalır)").click();
  });
};

describe("the bin button on a subtask row", () => {
  it("takes the subtask off the schedule without asking", () => {
    const plan = useStore.getState().createTask({ title: "Sunum" });
    const step = useStore
      .getState()
      .createTask({ title: "Slaytlar", parentId: plan.id, dueDate: today });

    mountRow(step.id);
    removeStep();

    expect(asked).toEqual([]);
    expect(dueDateOf(step.id)).toBeNull();
    // Unscheduled, not deleted: the plan still has its step.
    expect(live()).toHaveLength(2);
  });

  it("offers the day back through the undo toast", () => {
    const plan = useStore.getState().createTask({ title: "Sunum" });
    const step = useStore
      .getState()
      .createTask({ title: "Slaytlar", parentId: plan.id, dueDate: today });

    mountRow(step.id);
    removeStep();

    expect(useUndoStore.getState().pending?.label).toBe("undoneRemovedFromSchedule");
    act(() => {
      useUndoStore.getState().undo();
    });
    expect(dueDateOf(step.id)).toBe(today);
  });

  it("asks before the bin on a top-level task, which really deletes", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Tek görev", dueDate: today });

    mountRow(task.id);
    openRowMenu();
    act(() => {
      screen.getByText("Çöpe taşı").click();
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Tek görev");
    expect(live()).toHaveLength(0);
  });
});
