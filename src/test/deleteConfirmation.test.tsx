import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/state/store";
import { useRequestDelete } from "@/ui/task/useRequestDelete";

/**
 * Deleting a task takes every task beneath it. The question is whether the
 * user was told that before it happened — the delete itself is covered by
 * `destructiveActions`.
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

/*
 * Mounts the hook and hands back a caller that runs inside `act`: the delete
 * writes to the store, which re-renders the mounted hook.
 */
const requestDelete = () => {
  const { result } = renderHook(() => useRequestDelete());
  return (taskId: string) => {
    let outcome = false;
    act(() => {
      outcome = result.current(taskId);
    });
    return outcome;
  };
};

const live = () => useStore.getState().db.tasks.filter((t) => !t.deletedAt);

describe("useRequestDelete", () => {
  it("deletes a childless top-level task without asking", () => {
    const task = useStore.getState().createTask({ title: "Tek görev" });

    expect(requestDelete()(task.id)).toBe(true);

    expect(asked).toEqual([]);
    expect(live()).toHaveLength(0);
  });

  it("names the number of tasks that go with a parent", () => {
    const plan = useStore.getState().createTask({ title: "Sunum hazırlığı" });
    useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });
    const second = useStore.getState().createTask({ title: "Prova", parentId: plan.id });
    // A grandchild counts too: `deleteTask` trashes the whole subtree.
    useStore.getState().createTask({ title: "Zamanlama", parentId: second.id });

    expect(requestDelete()(plan.id)).toBe(true);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("3");
    expect(asked[0]).toContain("Sunum hazırlığı");
    expect(live()).toHaveLength(0);
  });

  it("deletes nothing when the question is declined", () => {
    const plan = useStore.getState().createTask({ title: "Sunum hazırlığı" });
    useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });
    answer = false;

    expect(requestDelete()(plan.id)).toBe(false);

    expect(asked).toHaveLength(1);
    expect(live()).toHaveLength(2);
  });

  it("does not count subtasks that are already in the trash", () => {
    const plan = useStore.getState().createTask({ title: "Sunum hazırlığı" });
    const kept = useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });
    const gone = useStore.getState().createTask({ title: "Eski taslak", parentId: plan.id });
    useStore.getState().deleteTask(gone.id);

    requestDelete()(plan.id);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("1");
    expect(asked[0]).not.toContain("2");
    expect(live()).toHaveLength(0);
    expect(kept.id).toBeTruthy();
  });

  it("still warns about a childless subtask, which is a different mistake", () => {
    const plan = useStore.getState().createTask({ title: "Sunum hazırlığı" });
    const child = useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });

    expect(requestDelete()(child.id)).toBe(true);

    expect(asked).toHaveLength(1);
    // The subtask warning points at "remove from today"; it never counts.
    expect(asked[0]).not.toContain("Slaytlar");
    expect(live().map((t) => t.id)).toEqual([plan.id]);
  });

  it("reports a task that is no longer there rather than deleting", () => {
    expect(requestDelete()("missing-id")).toBe(false);
    expect(asked).toEqual([]);
  });
});
