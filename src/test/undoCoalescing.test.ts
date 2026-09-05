import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";
import { flushDelayMs, localTaskFingerprint } from "@/state/syncEngine";
import { UNDO_WINDOW_MS, useUndoStore } from "@/state/undoStore";

/**
 * A change taken back must cost the backend nothing.
 *
 * The flush waited five seconds and the undo toast stood for eight, so any
 * regret arriving in that three-second gap — the ordinary case — was written
 * to the cloud and then written away again: two requests for a document that
 * ended where it started, and a value that flickered on every other device.
 *
 * Two things have to hold for that to cost nothing. The queue has to still be
 * waiting when the reversal lands (`flushDelayMs`), and the reversal has to
 * put the row back to the byte the cloud already holds, so the flush's
 * fingerprint check drops it (`localTaskFingerprint`).
 */
const NOW = 1_700_000_000_000;
const FLUSH_DELAY_MS = 5_000;
const FLUSH_MAX_WAIT_MS = 30_000;

describe("how long the queue waits", () => {
  it("uses the plain trailing delay when nothing is offered for undo", () => {
    expect(
      flushDelayMs({
        now: NOW,
        queuedSince: NOW,
        undoOfferExpiresAt: null,
      }),
    ).toBe(FLUSH_DELAY_MS);
  });

  it("waits out an undo offer that outlasts the delay", () => {
    expect(
      flushDelayMs({
        now: NOW,
        queuedSince: NOW,
        undoOfferExpiresAt: NOW + UNDO_WINDOW_MS,
      }),
    ).toBe(UNDO_WINDOW_MS);
  });

  it("does not shorten the delay for an offer about to lapse", () => {
    expect(
      flushDelayMs({
        now: NOW,
        queuedSince: NOW,
        undoOfferExpiresAt: NOW + 1_000,
      }),
    ).toBe(FLUSH_DELAY_MS);
  });

  it("lets the ceiling win, so a stream of toasts cannot starve the queue", () => {
    expect(
      flushDelayMs({
        now: NOW,
        queuedSince: NOW - (FLUSH_MAX_WAIT_MS - 1_000),
        undoOfferExpiresAt: NOW + UNDO_WINDOW_MS,
      }),
    ).toBe(1_000);
  });

  it("never asks a timer for a negative delay", () => {
    expect(
      flushDelayMs({
        now: NOW,
        queuedSince: NOW - FLUSH_MAX_WAIT_MS * 2,
        undoOfferExpiresAt: NOW + UNDO_WINDOW_MS,
      }),
    ).toBe(0);
  });
});

describe("what the queue finds after a reversal", () => {
  beforeEach(async () => {
    await useStore.getState().resetDatabase();
    await useStore.getState().hydrate();
  });

  const taskOf = (id: string) => {
    const task = useStore.getState().db.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`No task ${id}`);
    return task;
  };

  it("finds nothing to write: the row is byte-identical again", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Sunum", dueDate: "2026-08-25" });
    const before = localTaskFingerprint(taskOf(task.id));

    act(() => {
      useStore.getState().reschedule(task.id, "2026-08-27");
    });
    expect(localTaskFingerprint(taskOf(task.id))).not.toBe(before);

    act(() => {
      expect(useUndoStore.getState().undo()).toBe(true);
    });
    // Same fingerprint as before the move, so the flush skips the row entirely
    // — which is only reachable because the queue was still holding it.
    expect(localTaskFingerprint(taskOf(task.id))).toBe(before);
  });

  it("still records both steps in the task's history", () => {
    const task = useStore
      .getState()
      .createTask({ title: "Sunum", dueDate: "2026-08-25" });

    act(() => {
      useStore.getState().reschedule(task.id, "2026-08-27");
    });
    act(() => {
      useUndoStore.getState().undo();
    });

    // Spec section 5: rescheduling never erases what happened. Saving the
    // round trip is about the row, not about the trail.
    const trail = useStore
      .getState()
      .db.history.filter((h) => h.taskId === task.id);
    expect(trail.length).toBeGreaterThanOrEqual(2);
  });
});
