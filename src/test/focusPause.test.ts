import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toInstance } from "@/domain/task";
import type { Task } from "@/domain/types";
import { EMPTY_FILTERS, splitDay, useInstancesInRange } from "@/state/selectors";
import { useStore } from "@/state/store";
import { focusElapsedSec } from "@/state/storeTypes";

/**
 * Stepping away from a task is not the same as finishing with it.
 *
 * There were two buttons — stop, which ended the session, and cancel, which
 * threw it away — and nothing in between. So a five-minute interruption was
 * logged as a finished session and a fresh one afterwards, or the timer was
 * left running through it and the number stopped meaning anything. The panel
 * even had a button *labelled* "Duraklat" that ended the session and put the
 * task back to TODO.
 */
const TODAY = "2026-09-02";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

const store = () => useStore.getState();
const running = () => useStore.getState().runningFocus;
const sessionOf = (id: string) =>
  useStore.getState().db.focusSessions.find((s) => s.id === id)!;

/** Start a timer on a fresh task. */
const startOn = (title = "Sunum"): Task => {
  const task = store().createTask({ title, dueDate: TODAY });
  store().startFocus(toInstance(task, TODAY, null, new Date()));
  return task;
};

const advance = (seconds: number) =>
  vi.setSystemTime(new Date(Date.now() + seconds * 1000));

describe("pausing a timer", () => {
  it("stops the clock without ending the session", () => {
    const task = startOn();
    const sessionId = running()!.sessionId;

    advance(120);
    store().pauseFocus();

    expect(running()).not.toBeNull();
    expect(running()!.taskId).toBe(task.id);
    expect(running()!.runStartedAt).toBeNull();
    // Still open: a paused session is not a finished one.
    expect(sessionOf(sessionId).endedAt).toBeNull();
  });

  it("banks the seconds onto the row, so a pause that is never resumed keeps them", () => {
    startOn();
    const sessionId = running()!.sessionId;

    advance(120);
    store().pauseFocus();

    expect(sessionOf(sessionId).durationSec).toBe(120);
  });

  it("does not count the time spent paused", () => {
    startOn();
    const sessionId = running()!.sessionId;

    advance(120);
    store().pauseFocus();
    advance(600); // a long interruption
    store().resumeFocus();
    advance(60);
    store().stopFocus();

    expect(sessionOf(sessionId).durationSec).toBe(180);
    expect(sessionOf(sessionId).endedAt).not.toBeNull();
  });

  it("survives several rounds of it", () => {
    startOn();
    const sessionId = running()!.sessionId;

    for (const seconds of [30, 45, 25]) {
      advance(seconds);
      store().pauseFocus();
      advance(300);
      store().resumeFocus();
    }
    store().stopFocus();

    expect(sessionOf(sessionId).durationSec).toBe(100);
  });

  it("ignores a second press of the same button", () => {
    startOn();
    advance(60);
    store().pauseFocus();
    const banked = running()!.bankedSec;

    store().pauseFocus();
    expect(running()!.bankedSec).toBe(banked);

    // …and resuming twice must not restart the run and lose its seconds.
    store().resumeFocus();
    advance(10);
    const startedAgain = running()!.runStartedAt;
    store().resumeFocus();
    expect(running()!.runStartedAt).toBe(startedAgain);
  });

  it("counts up again from where it stopped", () => {
    startOn();
    advance(90);
    store().pauseFocus();

    expect(focusElapsedSec(running())).toBe(90);
    advance(300);
    // Held: the display must not drift while the clock is off.
    expect(focusElapsedSec(running())).toBe(90);

    store().resumeFocus();
    advance(10);
    expect(focusElapsedSec(running())).toBe(100);
  });

  it("still throws the whole session away when cancelled", () => {
    startOn();
    const sessionId = running()!.sessionId;
    advance(60);
    store().pauseFocus();

    store().cancelFocus();

    expect(running()).toBeNull();
    expect(
      useStore.getState().db.focusSessions.find((s) => s.id === sessionId),
    ).toBeUndefined();
  });
});

/**
 * One day, one order.
 *
 * Odaklanma listed today in whatever order the query returned while Today
 * printed timed work first, then the rest of the day, then what was finished.
 * Two screens showing one day two ways is the same fault as two records for
 * one task: the second one has to be re-read before it can be trusted.
 */
describe("the day both screens draw", () => {
  const dayOrder = () => {
    const { result } = renderHook(() =>
      useInstancesInRange(TODAY, TODAY, { ...EMPTY_FILTERS, showCompleted: true }),
    );
    return splitDay(result.current).ordered.map((i) => i.task.title);
  };

  it("puts the timed work first, then the rest, then what is done", () => {
    store().createTask({ title: "Tüm gün", dueDate: TODAY, allDay: true });
    store().createTask({
      title: "Saat 15",
      dueDate: TODAY,
      allDay: false,
      startTime: "15:00",
    });
    store().createTask({
      title: "Saat 09",
      dueDate: TODAY,
      allDay: false,
      startTime: "09:30",
    });
    const done = store().createTask({ title: "Biten", dueDate: TODAY });
    store().setStatus({ taskId: done.id, occurrenceDate: null }, "COMPLETED");

    expect(dayOrder()).toEqual(["Saat 09", "Saat 15", "Tüm gün", "Biten"]);
  });

  it("leaves deadlines out: a date is not something to spend an hour on", () => {
    store().createTask({ title: "Vize", dueDate: "2026-09-09", deadline: TODAY });

    expect(dayOrder()).not.toContain("Vize");
  });
});
