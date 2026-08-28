import { beforeEach, describe, expect, it } from "vitest";
import { toInstance } from "@/domain/task";
import { useStore } from "@/state/store";

/**
 * A deleted focus session must stay deleted across a sync.
 *
 * Deleting it locally only removes it; "removed here" and "never downloaded
 * here" look identical to the merge, so without a tombstone the next sync hands
 * the session straight back. The tombstone is the whole fix.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const db = () => useStore.getState().db;
const focusTombstones = () =>
  db().tombstones.filter((t) => t.kind === "focus").map((t) => t.id);

/** Start a timer on a fresh task and hand back the session it opened. */
const loggedSession = () => {
  const task = useStore.getState().createTask({ title: "Sunum" });
  useStore.getState().startFocus(toInstance(task, null, null, new Date()));
  return useStore.getState().runningFocus!.sessionId;
};

describe("deleting a focus session", () => {
  it("records a tombstone so the cloud cannot resurrect it", () => {
    const id = loggedSession();
    useStore.getState().stopFocus();

    useStore.getState().deleteFocusSession(id);

    expect(db().focusSessions.map((s) => s.id)).not.toContain(id);
    expect(focusTombstones()).toContain(id);
  });

  it("tombstones every session when the log is cleared", () => {
    const first = loggedSession();
    useStore.getState().stopFocus();
    const second = loggedSession();
    useStore.getState().stopFocus();

    useStore.getState().clearFocusSessions();

    expect(db().focusSessions).toHaveLength(0);
    expect(focusTombstones()).toEqual(expect.arrayContaining([first, second]));
  });

  it("tombstones a session abandoned mid-run", () => {
    const id = loggedSession();

    useStore.getState().cancelFocus();

    expect(useStore.getState().runningFocus).toBe(null);
    expect(focusTombstones()).toContain(id);
  });

  it("ignores an id that is not there, rather than piling up tombstones", () => {
    useStore.getState().deleteFocusSession("nope");
    expect(focusTombstones()).toHaveLength(0);
  });
});
