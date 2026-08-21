import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";

/**
 * The three ways a user can throw data away on purpose. Each one has to stop
 * exactly where it is meant to: emptying the trash must not touch the trail,
 * clearing the trail must not touch the tasks, and only a reset takes both.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const seed = () => {
  const store = useStore.getState();
  const kept = store.createTask({ title: "Prepare project presentation", dueDate: "2026-08-25" });
  const binned = store.createTask({ title: "Old draft", dueDate: "2026-08-20" });
  useStore.getState().addReminder({
    taskId: binned.id,
    kind: "RELATIVE",
    offsetMinutes: 10,
    remindAt: null,
  });
  useStore.getState().deleteTask(binned.id);
  return { kept, binned };
};

describe("emptyTrash", () => {
  it("purges trashed tasks and their reminders, and leaves the rest alone", () => {
    const { kept } = seed();
    const before = useStore.getState().db.history.length;

    useStore.getState().emptyTrash();

    const { db } = useStore.getState();
    expect(db.tasks.map((t) => t.id)).toEqual([kept.id]);
    expect(db.reminders).toHaveLength(0);
    // A purged task keeps its trail: that is the record it ever existed.
    expect(db.history.length).toBe(before);
  });

  it("leaves an untouched task in the trash alone when nothing is trashed", () => {
    useStore.getState().createTask({ title: "Only task" });
    useStore.getState().emptyTrash();
    expect(useStore.getState().db.tasks).toHaveLength(1);
  });
});

describe("clearHistory", () => {
  it("erases the trail without touching tasks or reminders", () => {
    seed();
    expect(useStore.getState().db.history.length).toBeGreaterThan(0);

    useStore.getState().clearHistory();

    const { db } = useStore.getState();
    expect(db.history).toEqual([]);
    expect(db.tasks).toHaveLength(2);
    expect(db.reminders).toHaveLength(1);
  });
});

describe("resetDatabase", () => {
  it("returns the app to a fresh install and writes that through", async () => {
    seed();
    useStore.getState().updateSettings({ dayStartHour: 3 });

    await useStore.getState().resetDatabase();

    const { db, runningFocus } = useStore.getState();
    expect(db.tasks).toEqual([]);
    expect(db.reminders).toEqual([]);
    expect(db.history).toEqual([]);
    expect(db.focusSessions).toEqual([]);
    expect(db.settings.dayStartHour).toBe(7);
    expect(runningFocus).toBeNull();

    // The point of resetting immediately: the file on disk is already empty,
    // so closing the app right afterwards cannot bring anything back.
    const written = localStorage.getItem("tempo.db.v1");
    expect(written).not.toBeNull();
    expect(JSON.parse(written as string).tasks).toEqual([]);
  });
});
