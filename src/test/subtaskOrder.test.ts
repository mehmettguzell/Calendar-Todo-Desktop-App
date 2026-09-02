import { beforeEach, describe, expect, it } from "vitest";
import { arrangeSteps } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * Subtask order is the one thing about a subtask that is pure presentation, so
 * it has to survive a drag without touching anything the trail cares about.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const seed = () => {
  const store = useStore.getState();
  const parent = store.createTask({ title: "Prepare project presentation" });
  const children = ["Outline", "Slides", "Rehearse"].map((title) =>
    useStore.getState().createTask({ title, parentId: parent.id }),
  );
  return { parent, children };
};

/** The order the panel reads: siblings of `parentId`, sorted by `order`. */
const orderOf = (parentId: string) =>
  useStore
    .getState()
    .db.tasks.filter((t) => t.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.title);

describe("reorderSubtasks", () => {
  it("stores the order it is given as a dense 0..n-1 run", () => {
    const { parent, children } = seed();

    useStore
      .getState()
      .reorderSubtasks(parent.id, [children[2]!.id, children[0]!.id, children[1]!.id]);

    expect(orderOf(parent.id)).toEqual(["Rehearse", "Outline", "Slides"]);
    const stored = useStore
      .getState()
      .db.tasks.filter((t) => t.parentId === parent.id)
      .map((t) => t.order)
      .sort((a, b) => a - b);
    expect(stored).toEqual([0, 1, 2]);
  });

  it("leaves another parent's subtasks alone", () => {
    const { parent, children } = seed();
    const other = useStore.getState().createTask({ title: "Book the room" });
    const otherChild = useStore
      .getState()
      .createTask({ title: "Check the projector", parentId: other.id });

    useStore.getState().reorderSubtasks(parent.id, [children[1]!.id, children[0]!.id]);

    expect(useStore.getState().db.tasks.find((t) => t.id === otherChild.id)?.order).toBe(0);
  });

  it("writes no history: a row that changed places is not task history", () => {
    const { parent, children } = seed();
    const before = useStore.getState().db.history.length;

    useStore.getState().reorderSubtasks(parent.id, [children[1]!.id, children[0]!.id]);

    expect(useStore.getState().db.history.length).toBe(before);
  });
});

/**
 * What the Plans card and the task panel both read. A finished step is
 * evidence, not work, so it stops sitting between the user and the next thing
 * to do — without its dragged place being written away.
 */
describe("arrangeSteps", () => {
  const stepsOf = (parentId: string) =>
    arrangeSteps(useStore.getState().db.tasks.filter((t) => t.parentId === parentId)).map(
      (t) => t.title,
    );

  it("sinks a completed step below the ones still open", () => {
    const { parent, children } = seed();

    useStore.getState().setStatus({ taskId: children[0]!.id, occurrenceDate: null }, "COMPLETED");

    expect(stepsOf(parent.id)).toEqual(["Slides", "Rehearse", "Outline"]);
  });

  it("keeps the dragged order inside each half", () => {
    const { parent, children } = seed();
    useStore
      .getState()
      .reorderSubtasks(parent.id, [children[2]!.id, children[1]!.id, children[0]!.id]);

    useStore.getState().setStatus({ taskId: children[1]!.id, occurrenceDate: null }, "COMPLETED");
    useStore.getState().setStatus({ taskId: children[2]!.id, occurrenceDate: null }, "COMPLETED");

    expect(stepsOf(parent.id)).toEqual(["Outline", "Rehearse", "Slides"]);
  });

  it("puts a reopened step straight back where it was", () => {
    const { parent, children } = seed();

    useStore.getState().setStatus({ taskId: children[0]!.id, occurrenceDate: null }, "COMPLETED");
    useStore.getState().setStatus({ taskId: children[0]!.id, occurrenceDate: null }, "TODO");

    expect(stepsOf(parent.id)).toEqual(["Outline", "Slides", "Rehearse"]);
  });
});
