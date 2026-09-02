import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deadlineProgress,
  isMissed,
  nextDeadline,
  sortDeadlines,
  type Deadline,
} from "@/domain/deadline";
import { EMPTY_FILTERS, useInstancesInRange } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * A plan holds as many deadlines as it has parts.
 *
 * `Task.deadline` is the one day the whole thing stops being on time. The
 * checkpoints on the way there — "backend bitecek, 25 Eylül" — are records of
 * their own: they are not the project's due date, and they are not steps
 * either. These tests pin that separation, the tick-off state, and the fact
 * that each one reaches the calendar under its own name.
 */

const TODAY = "2026-09-02";
const PAST = "2026-08-20";
const SOON = "2026-09-25";
const LATER = "2026-10-15";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

const plan = (title = "Proje") =>
  useStore.getState().createTask({ title, tags: ["plan"], dueDate: null });

const live = () => useStore.getState().db.deadlines.filter((d) => !d.deletedAt);

const byId = (id: string) =>
  useStore.getState().db.deadlines.find((d) => d.id === id)!;

const stub = (over: Partial<Deadline>): Deadline => ({
  id: "d",
  taskId: "t",
  label: "x",
  date: TODAY,
  completedAt: null,
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null,
  ...over,
});

describe("the deadline list", () => {
  it("orders by date, whatever order they were typed in", () => {
    const dates = sortDeadlines([
      stub({ id: "c", date: LATER }),
      stub({ id: "a", date: PAST }),
      stub({ id: "b", date: SOON }),
    ]).map((d) => d.id);

    expect(dates).toEqual(["a", "b", "c"]);
  });

  it("keeps a met checkpoint in its place rather than sinking it", () => {
    const order = sortDeadlines([
      stub({ id: "late", date: LATER }),
      stub({ id: "early", date: PAST, completedAt: "2026-08-19T00:00:00.000Z" }),
    ]).map((d) => d.id);

    expect(order).toEqual(["early", "late"]);
  });

  it("counts what has been met", () => {
    expect(
      deadlineProgress([
        stub({ completedAt: "2026-08-19T00:00:00.000Z" }),
        stub({}),
        stub({}),
      ]),
    ).toEqual({ met: 1, total: 3 });
  });

  it("calls a passed date missed only while it is still open", () => {
    expect(isMissed(stub({ date: PAST }), TODAY)).toBe(true);
    expect(
      isMissed(stub({ date: PAST, completedAt: "2026-08-19T00:00:00.000Z" }), TODAY),
    ).toBe(false);
    expect(isMissed(stub({ date: LATER }), TODAY)).toBe(false);
  });

  it("names a missed checkpoint as the next one, rather than skipping it", () => {
    const next = nextDeadline([
      stub({ id: "missed", date: PAST }),
      stub({ id: "upcoming", date: SOON }),
    ]);

    expect(next?.id).toBe("missed");
  });
});

describe("adding a deadline", () => {
  it("stores the label and the date against the task", () => {
    const p = plan();

    const added = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend bitecek", date: SOON });

    expect(added).not.toBeNull();
    expect(live()).toHaveLength(1);
    expect(byId(added!.id)).toMatchObject({
      taskId: p.id,
      label: "Backend bitecek",
      date: SOON,
      completedAt: null,
    });
  });

  it("holds several at once without them touching each other", () => {
    const p = plan();
    const store = useStore.getState();

    store.addDeadline({ taskId: p.id, label: "Tasarım", date: PAST });
    store.addDeadline({ taskId: p.id, label: "Backend", date: SOON });
    store.addDeadline({ taskId: p.id, label: "Yayın", date: LATER });

    expect(live().map((d) => d.label).sort()).toEqual([
      "Backend",
      "Tasarım",
      "Yayın",
    ]);
  });

  it("leaves the plan's own final deadline alone", () => {
    const p = plan();
    useStore.getState().updateTask(p.id, { deadline: LATER });

    useStore.getState().addDeadline({ taskId: p.id, label: "Backend", date: SOON });

    const stored = useStore.getState().db.tasks.find((t) => t.id === p.id)!;
    expect(stored.deadline).toBe(LATER);
  });

  it("refuses a checkpoint with no name — a bare date is not actionable", () => {
    const p = plan();

    expect(
      useStore.getState().addDeadline({ taskId: p.id, label: "   ", date: SOON }),
    ).toBeNull();
    expect(live()).toHaveLength(0);
  });

  it("refuses one with no date", () => {
    const p = plan();

    expect(
      useStore.getState().addDeadline({ taskId: p.id, label: "Backend", date: "" }),
    ).toBeNull();
    expect(live()).toHaveLength(0);
  });

  it("records the addition in the task's history", () => {
    const p = plan();
    useStore.getState().addDeadline({ taskId: p.id, label: "Backend", date: SOON });

    const kinds = useStore
      .getState()
      .db.history.filter((h) => h.taskId === p.id)
      .map((h) => h.kind);

    expect(kinds).toContain("DEADLINE_ADDED");
  });
});

describe("ticking a deadline off", () => {
  it("marks it met and stops it reading as missed", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Tasarım", date: PAST })!;
    expect(isMissed(byId(d.id), TODAY)).toBe(true);

    useStore.getState().setDeadlineMet(d.id, true);

    expect(byId(d.id).completedAt).not.toBeNull();
    expect(isMissed(byId(d.id), TODAY)).toBe(false);
  });

  it("can be put back to outstanding", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Tasarım", date: PAST })!;

    useStore.getState().setDeadlineMet(d.id, true);
    useStore.getState().setDeadlineMet(d.id, false);

    expect(byId(d.id).completedAt).toBeNull();
  });

  it("does not touch the task's own status", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Tasarım", date: PAST })!;

    useStore.getState().setDeadlineMet(d.id, true);

    expect(useStore.getState().db.tasks.find((t) => t.id === p.id)!.status).toBe(
      "TODO",
    );
  });
});

describe("editing a deadline", () => {
  it("renames it without moving it", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;

    useStore.getState().updateDeadline(d.id, { label: "Backend bitecek" });

    expect(byId(d.id)).toMatchObject({ label: "Backend bitecek", date: SOON });
  });

  it("moves it without renaming it, and says so in the history", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;

    useStore.getState().updateDeadline(d.id, { date: LATER });

    expect(byId(d.id)).toMatchObject({ label: "Backend", date: LATER });
    expect(
      useStore
        .getState()
        .db.history.filter((h) => h.taskId === p.id)
        .some((h) => h.kind === "RESCHEDULED" && h.from === SOON && h.to === LATER),
    ).toBe(true);
  });

  it("keeps the old name rather than accepting a blank one", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;

    useStore.getState().updateDeadline(d.id, { label: "   " });

    expect(byId(d.id).label).toBe("Backend");
  });

  it("leaves the plan's own deadline alone when one is moved", () => {
    const p = plan();
    useStore.getState().updateTask(p.id, { deadline: LATER });
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;

    useStore.getState().updateDeadline(d.id, { date: PAST });

    expect(useStore.getState().db.tasks.find((t) => t.id === p.id)!.deadline).toBe(
      LATER,
    );
  });
});

describe("removing a deadline", () => {
  it("keeps the row so an undo can put it back", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Tasarım", date: SOON })!;

    useStore.getState().removeDeadline(d.id);

    expect(live()).toHaveLength(0);
    expect(byId(d.id).deletedAt).not.toBeNull();
  });
});

describe("removing a deadline from the calendar", () => {
  it("takes the checkpoint away and leaves the plan standing", () => {
    const p = plan("Mobil uygulamayı yayınla");
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;

    useStore.getState().removeDeadline(d.id);

    expect(live()).toHaveLength(0);
    const stored = useStore.getState().db.tasks.find((t) => t.id === p.id)!;
    expect(stored.deletedAt).toBeNull();
    expect(stored.title).toBe("Mobil uygulamayı yayınla");
  });
});

describe("the calendar", () => {
  function chips(from: string, to: string) {
    const { result } = renderHook(() =>
      useInstancesInRange(from, to, EMPTY_FILTERS),
    );
    return result.current;
  }

  it("draws each checkpoint on its own day, under its own name", () => {
    const p = plan("Mobil uygulamayı yayınla");
    const store = useStore.getState();
    store.addDeadline({ taskId: p.id, label: "Backend bitecek", date: SOON });
    store.addDeadline({ taskId: p.id, label: "Yayın", date: LATER });

    const drawn = chips("2026-09-01", "2026-10-31")
      .filter((i) => i.deadlineLabel)
      .map((i) => ({ date: i.date, label: i.deadlineLabel, marker: i.isDeadline }));

    expect(drawn).toEqual([
      { date: SOON, label: "Backend bitecek", marker: true },
      { date: LATER, label: "Yayın", marker: true },
    ]);
  });

  it("carries the checkpoint's own id, so a chip can edit the right one", () => {
    const p = plan();
    const first = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;
    const second = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Yayın", date: LATER })!;

    const ids = chips("2026-09-01", "2026-10-31").map((i) => i.deadlineId);

    expect(ids).toEqual([first.id, second.id]);
  });

  it("does not paint the days leading up to a checkpoint", () => {
    const p = plan();
    useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON });

    expect(chips("2026-09-01", "2026-09-24")).toHaveLength(0);
  });

  it("leaves a checkpoint outside the rendered range alone", () => {
    const p = plan();
    useStore.getState().addDeadline({ taskId: p.id, label: "Yayın", date: LATER });

    expect(chips("2026-09-01", "2026-09-30")).toHaveLength(0);
  });

  it("hides a met checkpoint unless completed rows are being shown", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;
    useStore.getState().setDeadlineMet(d.id, true);

    expect(chips("2026-09-01", "2026-09-30")).toHaveLength(0);

    const { result } = renderHook(() =>
      useInstancesInRange("2026-09-01", "2026-09-30", {
        ...EMPTY_FILTERS,
        showCompleted: true,
      }),
    );
    expect(result.current.map((i) => i.deadlineLabel)).toEqual(["Backend"]);
  });

  it("gives a removed checkpoint no chip at all", () => {
    const p = plan();
    const d = useStore
      .getState()
      .addDeadline({ taskId: p.id, label: "Backend", date: SOON })!;

    useStore.getState().removeDeadline(d.id);

    expect(chips("2026-09-01", "2026-09-30")).toHaveLength(0);
  });
});
