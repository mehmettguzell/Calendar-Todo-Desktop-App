import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/state/store";
import { useRequestDelete } from "@/ui/task/useRequestDelete";

/**
 * Who gets asked before a delete goes through.
 *
 * Two facts are being protected: a top-level task is not thrown away on one
 * click, and a delete never takes tasks the user cannot see with it. A leaf
 * subtask is deliberately outside both — the delete itself is covered by
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
  it("asks before deleting a top-level task, even a childless one", () => {
    const task = useStore.getState().createTask({ title: "Tek görev" });

    expect(requestDelete()(task.id)).toBe(true);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Tek görev");
    expect(live()).toHaveLength(0);
  });

  it("keeps a top-level task when the question is declined", () => {
    const task = useStore.getState().createTask({ title: "Tek görev" });
    answer = false;

    expect(requestDelete()(task.id)).toBe(false);

    expect(live()).toHaveLength(1);
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

  it("deletes a leaf subtask without asking", () => {
    const plan = useStore.getState().createTask({ title: "Sunum hazırlığı" });
    const child = useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });

    expect(requestDelete()(child.id)).toBe(true);

    expect(asked).toEqual([]);
    expect(live().map((t) => t.id)).toEqual([plan.id]);
  });

  it("still asks about a subtask that carries steps of its own", () => {
    const plan = useStore.getState().createTask({ title: "Sunum hazırlığı" });
    const step = useStore.getState().createTask({ title: "Slaytlar", parentId: plan.id });
    useStore.getState().createTask({ title: "Kapak", parentId: step.id });

    expect(requestDelete()(step.id)).toBe(true);

    // Being a subtask is no excuse for taking a row nobody could see with it.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("1");
    expect(live().map((t) => t.id)).toEqual([plan.id]);
  });

  it("reports a task that is no longer there rather than deleting", () => {
    expect(requestDelete()("missing-id")).toBe(false);
    expect(asked).toEqual([]);
  });
});
