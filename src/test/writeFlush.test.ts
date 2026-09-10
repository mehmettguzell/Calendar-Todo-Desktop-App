import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const { supabaseMock } = await import("./supabaseMock");
  return { supabase: supabaseMock.client, isSupabaseConfigured: () => true };
});

import { supabaseMock } from "./supabaseMock";
import {
  FLUSH_DELAY_MS,
  forgetSyncedState,
  resetRetryBudget,
  syncDeleteTaskToCloud,
  syncTaskToCloud,
} from "@/sync";
import { useStore } from "@/state/store";
import { useAuthStore } from "@/state/authStore";
import { useSyncStore } from "@/state/syncStore";

/**
 * What a failed write must not do: lose the edit.
 *
 * The flush empties every queue before it makes a request, so if the request
 * fails, the only record that the change was ever pending is the `catch` that
 * puts the ids back. These tests pin that down — and the mirror-image rule that
 * a *successful* write is never repeated — before the queue and the flush are
 * split into separate modules.
 */
const flush = async () => {
  await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 1);
};

const pendingCount = () => useSyncStore.getState().pendingWrites;

beforeEach(async () => {
  vi.useFakeTimers();
  supabaseMock.reset();
  forgetSyncedState();
  resetRetryBudget();
  await useStore.getState().resetDatabase();
  useAuthStore.setState({ session: { user: { id: "u1" } } } as never);
});

afterEach(async () => {
  // Whatever a test left queued would otherwise fire inside the next one.
  supabaseMock.healAll();
  await flush();
  vi.useRealTimers();
  useAuthStore.setState({ session: null, user: null } as never);
});

describe("a batched write that succeeds", () => {
  it("sends the queued task and empties the queue", async () => {
    const task = useStore.getState().createTask({ title: "Send me" });
    expect(pendingCount()).toBeGreaterThan(0);

    await flush();

    const sent = supabaseMock.rowsSent("tasks", "upsert");
    expect(sent.map((r) => r.id)).toContain(task.id);
    expect(sent.every((r) => r.user_id === "u1")).toBe(true);
    expect(pendingCount()).toBe(0);
  });

  it("does not send the same unchanged row twice", async () => {
    const task = useStore.getState().createTask({ title: "Written once" });
    await flush();
    const firstPass = supabaseMock.rowsSent("tasks", "upsert").length;

    syncTaskToCloud(task);
    await flush();

    expect(supabaseMock.rowsSent("tasks", "upsert").length).toBe(firstPass);
  });
});

describe("a batched write that fails", () => {
  it("puts every id back so the next flush retries it", async () => {
    const task = useStore.getState().createTask({ title: "Server says no" });
    supabaseMock.failOn("tasks", { message: "network down", code: "500" });

    await flush();

    expect(useSyncStore.getState().phase).toBe("error");
    expect(pendingCount()).toBeGreaterThan(0);

    supabaseMock.healAll();
    supabaseMock.calls.length = 0;
    resetRetryBudget();
    syncTaskToCloud(task);
    await flush();

    expect(supabaseMock.rowsSent("tasks", "upsert").map((r) => r.id)).toContain(
      task.id,
    );
    expect(pendingCount()).toBe(0);
  });

  it("keeps a soft delete queued when the delete request fails", async () => {
    const task = useStore.getState().createTask({ title: "Delete me" });
    await flush();

    supabaseMock.failOn("tasks", { message: "no", code: "500" });
    syncDeleteTaskToCloud(task.id);
    await flush();

    expect(pendingCount()).toBeGreaterThan(0);
    expect(useSyncStore.getState().phase).toBe("error");
  });
});

describe("a task the cloud never heard of", () => {
  it("costs no request when it is created and trashed in one window", async () => {
    const task = useStore.getState().createTask({ title: "Never mind" });
    syncDeleteTaskToCloud(task.id);

    await flush();

    const touched = supabaseMock.calls.filter(
      (c) => c.table === "tasks" && c.rows.some((r) => r.id === task.id),
    );
    expect(touched).toEqual([]);
    expect(pendingCount()).toBe(0);
  });
});
