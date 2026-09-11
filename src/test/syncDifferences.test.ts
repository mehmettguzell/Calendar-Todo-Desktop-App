import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const { supabaseMock } = await import("./supabaseMock");
  return { supabase: supabaseMock.client, isSupabaseConfigured: () => true };
});

import { supabaseMock } from "./supabaseMock";
import { wireSyncPorts } from "@/state/syncWiring";
import {
  forgetSyncedState,
  pendingIds,
  resetPullState,
  resetRetryBudget,
  syncDifferences,
} from "@/sync";
import { useStore } from "@/state/store";
import { useAuthStore } from "@/state/authStore";
import { useSyncStore } from "@/state/syncStore";

/**
 * The safety net: reconcile both sides by content, with no queue or journal.
 *
 * A pass reads nine tables and writes back whichever side won, row by row.
 * Nothing else in the suite reaches it — the real client is null in tests and
 * the whole function returns early — so these are the only tests that
 * hold its shape while it is broken into pieces.
 */
const cloudTask = (over: Record<string, unknown> = {}) => ({
  id: "cloud-1",
  title: "Only in the cloud",
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

/** Answer every read from this table map; writes succeed silently. */
const cloudHolds = (rows: Record<string, Record<string, unknown>[]>) => {
  supabaseMock.respond((call) =>
    call.op === "select"
      ? { data: rows[call.table] ?? [], error: null }
      : undefined,
  );
};

const titles = () => useStore.getState().db.tasks.map((t) => t.title);

// The app installs the ports at startup; this suite drives the same engine.
wireSyncPorts();

beforeEach(async () => {
  supabaseMock.reset();
  forgetSyncedState();
  resetPullState();
  resetRetryBudget();
  for (const queue of Object.values(pendingIds)) queue.clear();
  await useStore.getState().resetDatabase();
  useAuthStore.setState({ session: { user: { id: "u1" } } } as never);
  cloudHolds({});
});

describe("a full reconciliation", () => {
  it("brings down a task only the cloud has", async () => {
    cloudHolds({ tasks: [cloudTask()] });

    const report = await syncDifferences({ manual: true });

    expect(report.success).toBe(true);
    expect(report.downloadedTasks).toBe(1);
    expect(titles()).toContain("Only in the cloud");
  });

  it("pushes a task only this device has", async () => {
    useStore.getState().createTask({ title: "Only here" });

    const report = await syncDifferences({ manual: true });

    expect(report.success).toBe(true);
    expect(
      supabaseMock.rowsSent("tasks", "upsert").map((r) => r.title),
    ).toContain("Only here");
  });

  it("lets the newer side win when both hold the row", async () => {
    const task = useStore.getState().createTask({ title: "Older here" });
    cloudHolds({
      tasks: [
        cloudTask({
          id: task.id,
          title: "Newer there",
          updated_at: "2099-01-01T00:00:00.000Z",
        }),
      ],
    });

    await syncDifferences({ manual: true });

    expect(titles()).toContain("Newer there");
    expect(titles()).not.toContain("Older here");
  });

  it("reports a failure code rather than the server's words", async () => {
    supabaseMock.respond((call) =>
      call.table === "tasks" && call.op === "select"
        ? { data: null, error: { message: "relation blew up", code: "500" } }
        : undefined,
    );

    const report = await syncDifferences({ manual: true });

    expect(report.success).toBe(false);
    expect(report.error).toBeTruthy();
    expect(JSON.stringify(report)).not.toContain("relation blew up");
    expect(useSyncStore.getState().phase).toBe("error");
  });

  it("does not re-read the account for a second pass moments later", async () => {
    await syncDifferences({ manual: true });
    const readsAfterFirst = supabaseMock.calls.filter(
      (c) => c.op === "select",
    ).length;

    const second = await syncDifferences();

    expect(second.success).toBe(true);
    expect(supabaseMock.calls.filter((c) => c.op === "select").length).toBe(
      readsAfterFirst,
    );
  });

  it("keeps a task this device purged from coming back", async () => {
    const task = useStore.getState().createTask({ title: "Purged here" });
    useStore.getState().deleteTask(task.id);
    useStore.getState().purgeTask(task.id);
    cloudHolds({ tasks: [cloudTask({ id: task.id, title: "Purged here" })] });

    await syncDifferences({ manual: true });

    expect(titles()).not.toContain("Purged here");
  });
});
