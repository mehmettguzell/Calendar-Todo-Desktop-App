import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_FILTERS, useTodoGroups } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * "Daha sonra" is a list of dates, so it reads in date order.
 *
 * The bucket spans everything past this week, and `compareInstances` used to
 * start at priority — so a plan set for December sat above one set for next
 * week whenever it was the more urgent of the two. The heading says only that
 * both are later; the order has to say which comes first, or every row has to
 * be read to find the next thing due.
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

const bucket = (id: string) => {
  const { result } = renderHook(() => useTodoGroups(EMPTY_FILTERS));
  return (
    result.current.find((g) => g.id === id)?.instances.map((i) => i.task.title) ??
    []
  );
};

describe("the Daha sonra bucket", () => {
  it("puts the nearest date first, whatever the priority is", () => {
    // Created in date order and prioritised against it, so neither insertion
    // order nor `order` can produce the right answer by accident.
    useStore
      .getState()
      .createTask({ title: "Aralık planı", dueDate: "2026-12-01", priority: "HIGH", tags: ["plan"] });
    useStore
      .getState()
      .createTask({ title: "Ekim planı", dueDate: "2026-10-05", priority: "LOW", tags: ["plan"] });
    useStore
      .getState()
      .createTask({ title: "Eylül planı", dueDate: "2026-09-15", priority: "MEDIUM", tags: ["plan"] });

    expect(bucket("later")).toEqual(["Eylül planı", "Ekim planı", "Aralık planı"]);
  });

  it("leaves a single day's order alone", () => {
    // One date, so the date test decides nothing and priority still leads.
    const day = "2026-09-15";
    useStore
      .getState()
      .createTask({ title: "Düşük", dueDate: day, priority: "LOW" });
    useStore
      .getState()
      .createTask({ title: "Yüksek", dueDate: day, priority: "HIGH" });

    expect(bucket("later")).toEqual(["Yüksek", "Düşük"]);
  });
});
