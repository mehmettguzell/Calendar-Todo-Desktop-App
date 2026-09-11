import { beforeEach, describe, expect, it } from "vitest";
import { isNote } from "@/domain/note";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * A task becoming a note, and back again.
 *
 * The note panel turns a note into a task by dropping one tag, because a note
 * carries nothing a task cannot hold. The other direction is not symmetrical: a
 * task can be scheduled, repeat and carry reminders, and Notes shows none of
 * those. So the conversion clears them rather than leaving a record that is
 * invisible in every list and still firing notifications — and the undo has to
 * give all of it back, or "turn into a note" is a one-way door with no sign.
 */

const DAY = "2026-09-25";

beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const byId = (id: string) =>
  useStore.getState().db.tasks.find((t) => t.id === id)!;

const remindersOf = (id: string) =>
  useStore.getState().db.reminders.filter((r) => r.taskId === id);

describe("turning a task into a note", () => {
  it("tags it as a note", () => {
    const task = useStore.getState().createTask({ title: "Fikir" });

    expect(useStore.getState().convertToNote(task.id)).toBe(true);
    expect(isNote(byId(task.id))).toBe(true);
  });

  it("clears the schedule a note cannot show", () => {
    const task = useStore.getState().createTask({
      title: "Sunum",
      dueDate: DAY,
      allDay: false,
      startTime: "14:00",
      endTime: "16:00",
      deadline: DAY,
      recurrence: { freq: "WEEKLY", interval: 1, until: null },
    });

    useStore.getState().convertToNote(task.id);

    const note = byId(task.id);
    expect(note.dueDate).toBeNull();
    expect(note.deadline).toBeNull();
    expect(note.recurrence).toBeNull();
    expect(note.startTime).toBeNull();
    expect(note.endTime).toBeNull();
    expect(note.allDay).toBe(true);
  });

  it("takes the reminders with it, so nothing fires for a note", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Sunum", dueDate: DAY });
    useStore.getState().addReminder({
      taskId: task.id,
      kind: "ABSOLUTE",
      offsetMinutes: null,
      remindAt: "2026-09-25T11:00:00.000Z",
    });
    expect(remindersOf(task.id)).toHaveLength(1);

    useStore.getState().convertToNote(task.id);

    expect(remindersOf(task.id)).toHaveLength(0);
  });

  it("keeps the title, description and category", () => {
    const task = useStore.getState().createTask({
      title: "Fikir",
      description: "Uzun uzun düşünülecek",
    });

    useStore.getState().convertToNote(task.id);

    expect(byId(task.id).title).toBe("Fikir");
    expect(byId(task.id).description).toBe("Uzun uzun düşünülecek");
  });

  it("records the change in the task's history", () => {
    const task = useStore.getState().createTask({ title: "Fikir" });

    useStore.getState().convertToNote(task.id);

    expect(
      useStore
        .getState()
        .db.history.filter((h) => h.taskId === task.id)
        .some((h) => h.field === "type" && h.to === "note"),
    ).toBe(true);
  });

  it("refuses a task with subtasks rather than hiding them", () => {
    const parent = useStore.getState().createTask({ title: "Proje" });
    useStore.getState().createTask({ title: "Adım", parentId: parent.id });

    expect(useStore.getState().convertToNote(parent.id)).toBe(false);
    expect(isNote(byId(parent.id))).toBe(false);
  });

  it("does nothing to something that is already a note", () => {
    const task = useStore.getState().createTask({ title: "Fikir" });
    useStore.getState().convertToNote(task.id);

    expect(useStore.getState().convertToNote(task.id)).toBe(false);
  });
});

describe("undoing the conversion", () => {
  it("gives back the schedule and the reminders together", () => {
    const task = useStore.getState().createTask({
      title: "Sunum",
      dueDate: DAY,
      allDay: false,
      startTime: "14:00",
    });
    useStore.getState().addReminder({
      taskId: task.id,
      kind: "ABSOLUTE",
      offsetMinutes: null,
      remindAt: "2026-09-25T11:00:00.000Z",
    });

    useStore.getState().convertToNote(task.id);
    expect(useUndoStore.getState().undo()).toBe(true);

    const back = byId(task.id);
    expect(isNote(back)).toBe(false);
    expect(back.dueDate).toBe(DAY);
    expect(back.startTime).toBe("14:00");
    expect(back.allDay).toBe(false);
    expect(remindersOf(task.id)).toHaveLength(1);
  });
});
