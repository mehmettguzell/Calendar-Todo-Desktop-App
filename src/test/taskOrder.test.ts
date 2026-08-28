import { beforeEach, describe, expect, it } from "vitest";
import { arrangeInstances } from "@/state/selectors";
import { toInstance } from "@/domain/task";
import { pinOf } from "@/domain/manualOrder";
import type { Task } from "@/domain/types";
import { useStore } from "@/state/store";

/**
 * Dragging a task must not cost it its priority sorting.
 *
 * The rule these tests hold to: a drag pins the row it moved and nothing else,
 * so every task the user has never touched still sorts itself.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const now = new Date();

/** Three tasks that priority alone would order High, Medium, Low. */
const seed = () => {
  const store = useStore.getState();
  return [
    store.createTask({ title: "High", priority: "HIGH" }),
    store.createTask({ title: "Medium", priority: "MEDIUM" }),
    store.createTask({ title: "Low", priority: "LOW" }),
  ];
};

const live = (): Task[] =>
  useStore.getState().db.tasks.filter((t) => t.deletedAt === null);

/** The list as the screen reads it. */
const shown = () =>
  arrangeInstances(
    live().map((task) => toInstance(task, task.dueDate, null, now)),
  ).map((instance) => instance.task.title);

const idsOf = (titles: string[]) =>
  titles.map((title) => live().find((t) => t.title === title)!.id);

describe("task ordering", () => {
  it("sorts by priority until something is dragged", () => {
    seed();
    expect(shown()).toEqual(["High", "Medium", "Low"]);
  });

  it("keeps a dragged task where it was dropped", () => {
    seed();
    const order = idsOf(["Medium", "High", "Low"]);

    useStore.getState().reorderTasks(order, order[0]!);

    expect(shown()).toEqual(["Medium", "High", "Low"]);
  });

  it("pins only the row that moved, so the rest keep sorting themselves", () => {
    const low = seed()[2]!;
    const order = idsOf(["Low", "High", "Medium"]);
    useStore.getState().reorderTasks(order, low.id);

    const pins = live().map((t) => [t.title, pinOf(t)]);
    expect(pins.sort()).toEqual([
      ["High", null],
      ["Low", 0],
      ["Medium", null],
    ]);

    // A new HIGH task still climbs above MEDIUM on its own — under the pin.
    useStore.getState().createTask({ title: "Urgent", priority: "HIGH" });
    expect(shown()).toEqual(["Low", "High", "Urgent", "Medium"]);
  });

  it("re-pins the rows already pinned, so no two rows claim one slot", () => {
    const low = seed()[2]!;
    let order = idsOf(["Low", "High", "Medium"]);
    useStore.getState().reorderTasks(order, low.id);

    // Now drag Medium to the top: Low has to give up slot 0 and take slot 1.
    const medium = live().find((t) => t.title === "Medium")!;
    order = idsOf(["Medium", "Low", "High"]);
    useStore.getState().reorderTasks(order, medium.id);

    expect(shown()).toEqual(["Medium", "Low", "High"]);
    expect(pinOf(live().find((t) => t.title === "Low")!)).toBe(1);
  });

  it("hands the list back to priority when the arrangement is cleared", () => {
    const low = seed()[2]!;
    const order = idsOf(["Low", "High", "Medium"]);
    useStore.getState().reorderTasks(order, low.id);

    useStore.getState().clearManualOrder(live().map((t) => t.id));

    expect(shown()).toEqual(["High", "Medium", "Low"]);
  });

  it("writes no history and no clock bump: a pin is not task history", () => {
    const high = seed()[0]!;
    const historyBefore = useStore.getState().db.history.length;
    const updatedBefore = high.updatedAt;

    const order = idsOf(["Medium", "High", "Low"]);
    useStore.getState().reorderTasks(order, order[0]!);

    expect(useStore.getState().db.history.length).toBe(historyBefore);
    expect(live().find((t) => t.id === high.id)?.updatedAt).toBe(updatedBefore);
  });

  it("leaves tasks outside the dragged list untouched", () => {
    seed();
    const outsider = useStore.getState().createTask({ title: "Elsewhere" });

    const order = idsOf(["Medium", "High", "Low"]);
    useStore.getState().reorderTasks(order, order[0]!);

    expect(pinOf(live().find((t) => t.id === outsider.id)!)).toBe(null);
  });
});
