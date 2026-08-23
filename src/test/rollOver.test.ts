import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";

/**
 * Rolling yesterday's unfinished work onto today.
 *
 * The behaviour that matters is what it REFUSES to move: finished work, work
 * that was never late, and recurring series whose dates come from a rule. A
 * roll-over that quietly moved any of those would make the due dates in this
 * app impossible to trust.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const TODAY = "2026-08-25";

describe("rollOverTo", () => {
  it("moves an unfinished, past-due task onto the new date", () => {
    const task = useStore.getState().createTask({
      title: "Prepare project presentation",
      dueDate: "2026-08-20",
    });

    const moved = useStore.getState().rollOverTo([task.id], TODAY);

    expect(moved).toBe(1);
    expect(useStore.getState().db.tasks.find((t) => t.id === task.id)?.dueDate).toBe(
      TODAY,
    );
  });

  it("records the move in history like any other reschedule", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Old draft", dueDate: "2026-08-20" });
    useStore.getState().rollOverTo([task.id], TODAY);

    const entry = useStore
      .getState()
      .db.history.find((h) => h.taskId === task.id && h.kind === "RESCHEDULED");

    expect(entry).toBeDefined();
    expect(entry?.note).toBe("Rolled over");
    expect(entry?.to).toContain(TODAY);
  });

  it("leaves a completed task where it is", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Already done", dueDate: "2026-08-20" });
    useStore
      .getState()
      .setStatus({ taskId: task.id, occurrenceDate: null }, "COMPLETED");

    expect(useStore.getState().rollOverTo([task.id], TODAY)).toBe(0);
    expect(useStore.getState().db.tasks.find((t) => t.id === task.id)?.dueDate).toBe(
      "2026-08-20",
    );
  });

  it("leaves a task that is not yet late alone", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Next week", dueDate: "2026-09-01" });

    expect(useStore.getState().rollOverTo([task.id], TODAY)).toBe(0);
  });

  it("never drags a recurring series with it", () => {
    // Moving the anchor would move every future occurrence too.
    const task = useStore.getState().createTask({
      title: "Standup",
      dueDate: "2026-08-20",
      recurrence: { freq: "DAILY", interval: 1 },
    });

    expect(useStore.getState().rollOverTo([task.id], TODAY)).toBe(0);
    expect(useStore.getState().db.tasks.find((t) => t.id === task.id)?.dueDate).toBe(
      "2026-08-20",
    );
  });

  it("drops an end date that would now sit before the new start", () => {
    const task = useStore.getState().createTask({
      title: "Sprint",
      dueDate: "2026-08-18",
      endDate: "2026-08-21",
    });

    useStore.getState().rollOverTo([task.id], TODAY);
    const moved = useStore.getState().db.tasks.find((t) => t.id === task.id);

    expect(moved?.dueDate).toBe(TODAY);
    expect(moved?.endDate).toBeNull();
  });

  it("clears a stale snooze so the task is actually visible again", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Snoozed and forgotten", dueDate: "2026-08-20" });
    useStore.setState((s) => ({
      db: {
        ...s.db,
        tasks: s.db.tasks.map((t) =>
          t.id === task.id ? { ...t, snoozedUntil: "2026-08-21T09:00:00.000Z" } : t,
        ),
      },
    }));

    useStore.getState().rollOverTo([task.id], TODAY);

    expect(
      useStore.getState().db.tasks.find((t) => t.id === task.id)?.snoozedUntil,
    ).toBeNull();
  });

  it("moves several tasks in one pass and reports the count", () => {
    const a = useStore.getState().createTask({ title: "A", dueDate: "2026-08-19" });
    const b = useStore.getState().createTask({ title: "B", dueDate: "2026-08-20" });
    const future = useStore
      .getState()
      .createTask({ title: "C", dueDate: "2026-09-09" });

    expect(useStore.getState().rollOverTo([a.id, b.id, future.id], TODAY)).toBe(2);
  });
});
