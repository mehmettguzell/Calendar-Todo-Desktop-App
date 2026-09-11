import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const { supabaseMock } = await import("./supabaseMock");
  return { supabase: supabaseMock.client, isSupabaseConfigured: () => true };
});

import { supabaseMock } from "./supabaseMock";
import { wireSyncPorts } from "@/state/syncWiring";
import {
  forgetSyncedState,
  isApplyingRemoteUpdate,
  pendingIds,
  setupRealtime,
  teardownRealtime,
} from "@/sync";
import { useStore } from "@/state/store";
import { useSyncStore } from "@/state/syncStore";

/**
 * What another device's edit is allowed to do to this one.
 *
 * The channel echoes this device's own writes back at it, so "apply whatever
 * arrives" is wrong: a purge would undo itself and an in-flight edit would be
 * reverted to the version already on the wire. These tests pin the order the
 * guards run in, which no other test covers.
 */
const cloudTask = (over: Record<string, unknown> = {}) => ({
  id: "remote-1",
  title: "From the phone",
  description: null,
  category_id: null,
  parent_id: null,
  priority: "medium",
  status: "todo",
  tags: [],
  due_date: null,
  all_day: true,
  start_time: null,
  end_time: null,
  recurrence: null,
  snoozed_until: null,
  completed_at: null,
  is_deleted: false,
  created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-01T10:00:00.000Z",
  ...over,
});

const taskTitles = () => useStore.getState().db.tasks.map((t) => t.title);

// The app installs the ports at startup; this suite drives the same engine.
wireSyncPorts();

beforeEach(async () => {
  supabaseMock.reset();
  forgetSyncedState();
  for (const queue of Object.values(pendingIds)) queue.clear();
  await useStore.getState().resetDatabase();
  setupRealtime("u1");
});

afterEach(() => {
  teardownRealtime();
});

describe("the realtime channel", () => {
  it("subscribes once and reports itself connected", () => {
    expect(supabaseMock.channels).toEqual(["user-sync-u1"]);
    expect(useSyncStore.getState().realtime).toBe("connected");
  });

  it("applies a task another device inserted", () => {
    supabaseMock.emit("tasks", {
      eventType: "INSERT",
      new: cloudTask(),
      old: {},
    });

    expect(taskTitles()).toContain("From the phone");
  });

  it("leaves the remote-apply guard closed once it is done", () => {
    supabaseMock.emit("tasks", {
      eventType: "INSERT",
      new: cloudTask({ id: "remote-2" }),
      old: {},
    });

    expect(isApplyingRemoteUpdate()).toBe(false);
  });

  it("ignores a row older than the copy already here", () => {
    supabaseMock.emit("tasks", {
      eventType: "INSERT",
      new: cloudTask({ updated_at: "2026-09-02T10:00:00.000Z" }),
      old: {},
    });
    supabaseMock.emit("tasks", {
      eventType: "UPDATE",
      new: cloudTask({
        title: "Stale echo",
        updated_at: "2026-09-01T10:00:00.000Z",
      }),
      old: {},
    });

    expect(taskTitles()).toContain("From the phone");
    expect(taskTitles()).not.toContain("Stale echo");
  });

  it("refuses to overwrite a row this device has queued", () => {
    supabaseMock.emit("tasks", { eventType: "INSERT", new: cloudTask(), old: {} });
    pendingIds.tasks.add("remote-1");

    supabaseMock.emit("tasks", {
      eventType: "UPDATE",
      new: cloudTask({
        title: "Server wins?",
        updated_at: "2026-12-01T10:00:00.000Z",
      }),
      old: {},
    });

    expect(taskTitles()).not.toContain("Server wins?");
  });

  it("drops a hard delete and the rows that hung off it", () => {
    supabaseMock.emit("tasks", { eventType: "INSERT", new: cloudTask(), old: {} });
    supabaseMock.emit("tasks", {
      eventType: "DELETE",
      new: {},
      old: { id: "remote-1" },
    });

    expect(taskTitles()).not.toContain("From the phone");
  });

  it("ignores a payload delivered to the wrong table's handler", () => {
    const before = useStore.getState().db.occurrences.length;
    supabaseMock.emit("occurrences", {
      eventType: "INSERT",
      table: "tasks",
      new: cloudTask({ id: "stray" }),
      old: {},
    });

    expect(useStore.getState().db.occurrences.length).toBe(before);
  });
});
