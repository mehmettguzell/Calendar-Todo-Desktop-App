import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extraDaysPatch } from "@/domain/extraDays";
import { EMPTY_FILTERS, useTodoGroups } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * "Put this on tomorrow as well" has to be visible in the Todo list.
 *
 * Extra days are not a copy: the task gains a bounded weekly rule and occurs
 * on both days (see `domain/extraDays.ts`). The Todo view used to collapse
 * every task to one representative run, so the second day existed in the data
 * and on the calendar and nowhere the user was looking — which reads exactly
 * like the app dropping the edit.
 */

// A Tuesday. Tomorrow is the Wednesday beside it.
const TUESDAY = "2026-08-25";
const WEDNESDAY = "2026-08-26";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TUESDAY}T09:00:00`));
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

function groups() {
  const { result } = renderHook(() => useTodoGroups(EMPTY_FILTERS));
  return new Map(
    result.current.map((g) => [g.id, g.instances.map((i) => i.task.title)]),
  );
}

describe("the Todo projection", () => {
  it("lists a task on both of its days once tomorrow is ticked", () => {
    const task = useStore
      .getState()
      .createTask({ title: "İş başvurusu", dueDate: TUESDAY });

    useStore
      .getState()
      .updateTask(
        task.id,
        extraDaysPatch(useStore.getState().db.tasks[0]!, [TUESDAY, WEDNESDAY], 1),
      );

    const byGroup = groups();
    expect(byGroup.get("today")).toContain("İş başvurusu");
    expect(byGroup.get("tomorrow")).toContain("İş başvurusu");
  });

  it("still lists an ordinary task once, on its own day", () => {
    useStore.getState().createTask({ title: "Tek gün", dueDate: WEDNESDAY });

    const byGroup = groups();
    expect(byGroup.get("tomorrow")).toEqual(["Tek gün"]);
    expect(byGroup.get("today")).toBeUndefined();
  });

  it("does not list a weekly repeat twice in the same group", () => {
    useStore.getState().createTask({
      title: "Haftalık",
      dueDate: TUESDAY,
      recurrence: { freq: "WEEKLY", interval: 1, byWeekday: [2], until: null },
    });

    expect(groups().get("today")).toEqual(["Haftalık"]);
  });
});
