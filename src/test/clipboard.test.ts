import { beforeEach, describe, expect, it } from "vitest";
import { representativeInstance } from "@/domain/task";
import { pasteTaskOn } from "@/state/clipboardActions";
import { useClipboardStore } from "@/state/clipboardStore";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * Copying a task onto another day.
 *
 * The rule being defended here is that a copy is a *new* task: the two must be
 * completable, movable and deletable without touching each other. The moment
 * one of them can reach the other, "copy" has quietly become "second view of
 * the same thing" — which the app already has a much better answer for.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
  useClipboardStore.getState().clear();
  useUndoStore.setState({ pending: null });
});

const MONDAY = "2026-08-24";
const THURSDAY = "2026-08-27";

const task = (title: string, dueDate: string | null = MONDAY) =>
  useStore.getState().createTask({ title, dueDate, allDay: true });

const byId = (id: string) => useStore.getState().db.tasks.find((t) => t.id === id);

const instanceOf = (taskId: string) =>
  representativeInstance(byId(taskId)!, new Map(), new Date());

describe("duplicateTask", () => {
  it("puts an independent copy on the target day", () => {
    const source = task("Prepare project presentation");
    const copy = useStore.getState().duplicateTask(source.id, { dueDate: THURSDAY });

    expect(copy).not.toBeNull();
    expect(copy?.id).not.toBe(source.id);
    expect(copy?.title).toBe("Prepare project presentation");
    expect(copy?.dueDate).toBe(THURSDAY);
    expect(byId(source.id)?.dueDate).toBe(MONDAY);
  });

  it("leaves the original alone when the copy is completed", () => {
    const source = task("Standup");
    const copy = useStore.getState().duplicateTask(source.id, { dueDate: THURSDAY });

    useStore
      .getState()
      .setStatus({ taskId: copy?.id ?? "", occurrenceDate: null }, "COMPLETED");

    expect(byId(copy?.id ?? "")?.status).toBe("COMPLETED");
    expect(byId(source.id)?.status).toBe("TODO");
  });

  it("starts the copy fresh even when the original is finished", () => {
    const source = task("Weekly report");
    useStore
      .getState()
      .setStatus({ taskId: source.id, occurrenceDate: null }, "COMPLETED");

    const copy = useStore.getState().duplicateTask(source.id, { dueDate: THURSDAY });

    expect(copy?.status).toBe("TODO");
    expect(copy?.completedAt).toBeNull();
  });

  it("brings the subtasks along, re-parented onto the copy", () => {
    const source = task("Launch");
    useStore.getState().createTask({ title: "Write copy", parentId: source.id });
    useStore.getState().createTask({ title: "Ship it", parentId: source.id });

    const copy = useStore.getState().duplicateTask(source.id, { dueDate: THURSDAY });
    const children = useStore
      .getState()
      .db.tasks.filter((t) => t.parentId === copy?.id);

    expect(children.map((c) => c.title).sort()).toEqual(["Ship it", "Write copy"]);
    expect(
      useStore.getState().db.tasks.filter((t) => t.parentId === source.id),
    ).toHaveLength(2);
  });

  it("records where the copy came from", () => {
    const source = task("Prepare project presentation");
    const copy = useStore.getState().duplicateTask(source.id, { dueDate: THURSDAY });

    const created = useStore
      .getState()
      .db.history.find((h) => h.taskId === copy?.id && h.kind === "CREATED");

    expect(created?.note).toContain("Prepare project presentation");
  });

  it("can be taken back in one step", () => {
    const source = task("Prepare project presentation");
    const copy = useStore.getState().duplicateTask(source.id, { dueDate: THURSDAY });

    useUndoStore.getState().undo();

    expect(byId(copy?.id ?? "")).toBeUndefined();
    expect(byId(source.id)).toBeDefined();
  });

  it("does nothing for a task that is not there", () => {
    expect(useStore.getState().duplicateTask("nope")).toBeNull();
  });
});

describe("paste", () => {
  it("does nothing with an empty clipboard", () => {
    expect(pasteTaskOn(THURSDAY)).toBeNull();
  });

  it("copies onto the target day and keeps the clip for the next paste", () => {
    const source = task("Standup");
    useClipboardStore.getState().copy(source.id, source.title, MONDAY);

    expect(pasteTaskOn(THURSDAY)).toBe("copied");
    expect(pasteTaskOn("2026-08-28")).toBe("copied");

    const standups = useStore
      .getState()
      .db.tasks.filter((t) => t.title === "Standup");
    expect(standups.map((t) => t.dueDate).sort()).toEqual([
      MONDAY,
      THURSDAY,
      "2026-08-28",
    ]);
  });

  it("moves rather than copies after a cut, and empties the clipboard", () => {
    const source = task("Dentist");
    useClipboardStore.getState().cut(source.id, source.title, MONDAY);

    expect(pasteTaskOn(THURSDAY)).toBe("moved");
    expect(byId(source.id)?.dueDate).toBe(THURSDAY);
    expect(useStore.getState().db.tasks.filter((t) => t.title === "Dentist")).toHaveLength(1);
    expect(useClipboardStore.getState().clip).toBeNull();
  });

  it("forgets a clip whose task has been deleted", () => {
    const source = task("Gone");
    useClipboardStore.getState().copy(source.id, source.title, MONDAY);
    useStore.getState().deleteTask(source.id);

    expect(pasteTaskOn(THURSDAY)).toBeNull();
    expect(useClipboardStore.getState().clip).toBeNull();
  });
});

describe("moving a task", () => {
  it("keeps a multi-day run the same length", () => {
    const conference = useStore.getState().createTask({
      title: "Berlin conference",
      dueDate: "2026-08-25",
      endDate: "2026-08-28",
      allDay: true,
    });

    useStore.getState().reschedule(conference.id, "2026-09-01");

    expect(byId(conference.id)?.dueDate).toBe("2026-09-01");
    expect(byId(conference.id)?.endDate).toBe("2026-09-04");
  });

  it("can be taken back in one step", () => {
    const source = task("Dentist");
    useStore.getState().reschedule(source.id, THURSDAY);

    useUndoStore.getState().undo();

    expect(byId(source.id)?.dueDate).toBe(MONDAY);
  });

  it("says nothing happened when the task is already there", () => {
    const source = task("Dentist");
    useStore.getState().reschedule(source.id, MONDAY);
    expect(useUndoStore.getState().pending).toBeNull();
  });
});

describe("completing a task with subtasks", () => {
  it("finishes the subtasks with it", () => {
    const parent = task("Launch");
    const child = useStore
      .getState()
      .createTask({ title: "Write copy", parentId: parent.id });

    useStore
      .getState()
      .setStatus({ taskId: parent.id, occurrenceDate: null }, "COMPLETED");

    expect(byId(child.id)?.status).toBe("COMPLETED");
  });

  it("says so in the subtask's own history", () => {
    const parent = task("Launch");
    const child = useStore
      .getState()
      .createTask({ title: "Write copy", parentId: parent.id });

    useStore
      .getState()
      .setStatus({ taskId: parent.id, occurrenceDate: null }, "COMPLETED");

    const entry = useStore
      .getState()
      .db.history.filter((h) => h.taskId === child.id && h.kind === "STATUS_CHANGED")
      .at(-1);
    expect(entry?.note).toContain("Launch");
  });

  it("leaves finished subtasks finished when the parent is reopened", () => {
    const parent = task("Launch");
    const child = useStore
      .getState()
      .createTask({ title: "Write copy", parentId: parent.id });

    useStore
      .getState()
      .setStatus({ taskId: parent.id, occurrenceDate: null }, "COMPLETED");
    useStore.getState().setStatus({ taskId: parent.id, occurrenceDate: null }, "TODO");

    expect(byId(parent.id)?.status).toBe("TODO");
    expect(byId(child.id)?.status).toBe("COMPLETED");
  });

  it("puts the subtasks back when the completion itself is undone", () => {
    const parent = task("Launch");
    const child = useStore
      .getState()
      .createTask({ title: "Write copy", parentId: parent.id });
    useStore.getState().toggleComplete(instanceOf(parent.id));
    expect(byId(child.id)?.status).toBe("COMPLETED");

    useUndoStore.getState().undo();

    expect(byId(parent.id)?.status).toBe("TODO");
    expect(byId(child.id)?.status).toBe("TODO");
  });
});
