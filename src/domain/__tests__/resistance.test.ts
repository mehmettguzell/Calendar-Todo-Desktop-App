import { describe, expect, it } from "vitest";
import { taskResistance } from "../resistance";
import type { HistoryEntry, HistoryKind } from "../types";

let clock = 0;

/** Entries in creation order; `at` increases so ordering is unambiguous. */
function entry(kind: HistoryKind, to: string | null = null): HistoryEntry {
  clock += 1;
  return {
    id: `h_${clock}`,
    taskId: "t_1",
    at: new Date(Date.UTC(2026, 7, 25, 0, 0, clock)).toISOString(),
    kind,
    occurrenceDate: null,
    field: null,
    from: null,
    to,
    note: null,
  };
}

describe("taskResistance", () => {
  it("says nothing about a task nobody has postponed", () => {
    const r = taskResistance([entry("CREATED"), entry("UPDATED")]);
    expect(r.level).toBe("none");
    expect(r.postponements).toBe(0);
  });

  it("stays quiet at two postponements — that is an ordinary week", () => {
    const r = taskResistance([entry("CREATED"), entry("SNOOZED"), entry("SNOOZED")]);
    expect(r.level).toBe("none");
  });

  it("speaks up on the third", () => {
    const r = taskResistance([
      entry("CREATED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
    ]);
    expect(r.level).toBe("noticed");
    expect(r.postponements).toBe(3);
  });

  it("calls five stuck", () => {
    const r = taskResistance([
      entry("CREATED"),
      ...Array.from({ length: 5 }, () => entry("SNOOZED")),
    ]);
    expect(r.level).toBe("stuck");
    expect(r.postponements).toBe(5);
  });

  it("resets the run once the task is actually worked on", () => {
    const r = taskResistance([
      entry("CREATED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
      entry("FOCUS_LOGGED"),
      entry("SNOOZED"),
    ]);
    // Focus time is the task moving. Only the snooze after it is still live —
    // the three before it were answered by actually doing some of the work.
    expect(r.postponements).toBe(1);
    expect(r.level).toBe("none");
  });

  it("treats starting the task as progress", () => {
    const r = taskResistance([
      entry("SNOOZED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
      entry("STATUS_CHANGED", "IN_PROGRESS"),
      entry("SNOOZED"),
      entry("SNOOZED"),
    ]);
    expect(r.postponements).toBe(2);
    expect(r.level).toBe("none");
  });

  it("does not treat going back to TODO as progress", () => {
    const r = taskResistance([
      entry("SNOOZED"),
      entry("STATUS_CHANGED", "TODO"),
      entry("SNOOZED"),
      entry("SNOOZED"),
    ]);
    expect(r.postponements).toBe(3);
    expect(r.level).toBe("noticed");
  });

  it("ignores the RESCHEDULED entry a day-jumping snooze also writes", () => {
    // Spec §8: "Snooze → Tomorrow" postpones *and* moves the task, so store.ts
    // records both. That is one act of postponement, not two.
    const r = taskResistance([
      entry("CREATED"),
      entry("SNOOZED"),
      entry("RESCHEDULED"),
      entry("SNOOZED"),
      entry("RESCHEDULED"),
    ]);
    expect(r.postponements).toBe(2);
    expect(r.level).toBe("none");
  });

  it("does not flag someone who simply reorganises their week", () => {
    const r = taskResistance([
      entry("CREATED"),
      ...Array.from({ length: 6 }, () => entry("RESCHEDULED")),
    ]);
    expect(r.level).toBe("none");
  });

  it("reports when the run started, not when the task was made", () => {
    const created = entry("CREATED");
    const first = entry("SNOOZED");
    const second = entry("SNOOZED");
    const third = entry("SNOOZED");
    const r = taskResistance([created, first, second, third]);
    // The oldest postponement in the run, so the UI can say how long this has
    // been going on — not the task's birthday, and not the latest snooze.
    expect(r.since).toBe(first.at);
    expect(r.since).not.toBe(created.at);
    expect(r.since).not.toBe(second.at);
  });

  it("does not depend on the order it is handed the entries", () => {
    const rows = [
      entry("CREATED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
      entry("SNOOZED"),
    ];
    expect(taskResistance([...rows].reverse())).toEqual(taskResistance(rows));
  });

  it("handles a task with no history at all", () => {
    expect(taskResistance([]).level).toBe("none");
  });
});
