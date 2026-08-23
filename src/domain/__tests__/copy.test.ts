import { describe, expect, it } from "vitest";
import { copyOfTask, copySubtree } from "../copy";
import type { Task } from "../types";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Prepare project presentation",
  description: "slides + handout",
  status: "COMPLETED",
  priority: "HIGH",
  dueDate: "2026-08-25",
  endDate: null,
  allDay: false,
  startTime: "14:00",
  endTime: "16:00",
  categoryId: "c1",
  tags: ["work"],
  parentId: null,
  recurrence: null,
  snoozedUntil: "2026-08-25T09:00:00.000Z",
  order: 3,
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-02T09:00:00.000Z",
  completedAt: "2026-08-02T09:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const ids = () => {
  let n = 0;
  return () => `copy${(n += 1)}`;
};

const AT = "2026-08-23T10:00:00.000Z";

describe("copying one task", () => {
  it("keeps the content and drops the progress", () => {
    const copy = copyOfTask(task(), { dueDate: "2026-08-27" }, AT, ids());

    expect(copy.id).toBe("copy1");
    expect(copy.title).toBe("Prepare project presentation");
    expect(copy.description).toBe("slides + handout");
    expect(copy.priority).toBe("HIGH");
    expect(copy.categoryId).toBe("c1");
    expect(copy.tags).toEqual(["work"]);

    expect(copy.status).toBe("TODO");
    expect(copy.completedAt).toBeNull();
    expect(copy.snoozedUntil).toBeNull();
    expect(copy.deletedAt).toBeNull();
    expect(copy.createdAt).toBe(AT);
  });

  it("lands on the requested day at the same time of day", () => {
    const copy = copyOfTask(task(), { dueDate: "2026-08-27" }, AT, ids());
    expect(copy.dueDate).toBe("2026-08-27");
    expect(copy.startTime).toBe("14:00");
    expect(copy.endTime).toBe("16:00");
  });

  it("stays on the source day when no target is given", () => {
    expect(copyOfTask(task(), {}, AT, ids()).dueDate).toBe("2026-08-25");
  });

  it("keeps a multi-day run the same length", () => {
    const conference = task({ dueDate: "2026-08-25", endDate: "2026-08-28" });
    const copy = copyOfTask(conference, { dueDate: "2026-09-01" }, AT, ids());
    expect(copy.dueDate).toBe("2026-09-01");
    expect(copy.endDate).toBe("2026-09-04");
  });

  it("keeps a timed task the same length when the start moves", () => {
    const copy = copyOfTask(task(), { startTime: "09:30" }, AT, ids());
    expect(copy.startTime).toBe("09:30");
    expect(copy.endTime).toBe("11:30");
  });

  it("clamps rather than wrapping past midnight", () => {
    const copy = copyOfTask(task(), { startTime: "23:00" }, AT, ids());
    expect(copy.endTime).toBe("23:59");
  });

  it("copies one occurrence of a series as a plain task, not a second series", () => {
    const daily = task({
      recurrence: { freq: "DAILY", interval: 1, until: null, count: null },
    });
    expect(copyOfTask(daily, { dueDate: "2026-08-27" }, AT, ids()).recurrence).toBeNull();
  });

  it("can be copied onto no date at all", () => {
    const copy = copyOfTask(task(), { dueDate: null }, AT, ids());
    expect(copy.dueDate).toBeNull();
    expect(copy.endDate).toBeNull();
  });
});

describe("copying a task with subtasks", () => {
  const tree: Task[] = [
    task({ id: "root", title: "Launch", parentId: null, order: 0 }),
    task({ id: "a", title: "Write copy", parentId: "root", order: 0, dueDate: "2026-08-26" }),
    task({ id: "b", title: "Ship", parentId: "root", order: 1 }),
    task({ id: "a1", title: "Draft", parentId: "a", order: 0 }),
    task({ id: "trashed", parentId: "root", order: 2, deletedAt: AT }),
    task({ id: "unrelated", parentId: null, order: 9 }),
  ];

  it("brings the whole subtree and re-parents it onto the copies", () => {
    const copies = copySubtree(tree, "root", { dueDate: "2026-09-01" }, AT, ids());

    expect(copies.map((c) => c.title)).toEqual(["Launch", "Write copy", "Ship", "Draft"]);
    const [root, writeCopy, ship, draft] = copies as [Task, Task, Task, Task];
    expect(root.parentId).toBeNull();
    expect(writeCopy.parentId).toBe(root.id);
    expect(ship.parentId).toBe(root.id);
    expect(draft.parentId).toBe(writeCopy.id);
    expect(new Set(copies.map((c) => c.id)).size).toBe(4);
  });

  it("re-dates only the root", () => {
    const copies = copySubtree(tree, "root", { dueDate: "2026-09-01" }, AT, ids());
    expect(copies[0]?.dueDate).toBe("2026-09-01");
    expect(copies[1]?.dueDate).toBe("2026-08-26");
  });

  it("leaves trashed children behind", () => {
    const copies = copySubtree(tree, "root", {}, AT, ids());
    expect(copies.some((c) => c.title === tree[4]?.title && c.deletedAt !== null)).toBe(false);
  });

  it("returns nothing for a task that is not there", () => {
    expect(copySubtree(tree, "nope", {}, AT, ids())).toEqual([]);
  });
});
