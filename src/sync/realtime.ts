import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  handleRealtimeBudgetCategoryChange,
  handleRealtimeCategoryChange,
  handleRealtimeOccurrenceChange,
  handleRealtimeReminderChange,
  handleRealtimeTaskChange,
  handleRealtimeTransactionChange,
  type RealtimeRowChange,
} from "./realtimeApply";
import { persist } from "@/data/localDocument";
import { useStore } from "@/state/store";
import { isOnline, useSyncStore } from "@/state/syncStore";
import { currentUserId } from "./account";
import { beginRemoteApply, endRemoteApply } from "./remoteApply";

/** What the engine does once the channel is live again, injected to avoid a cycle. */
interface RealtimeDeps {
  onSubscribed(userId: string): void;
}

let deps: RealtimeDeps = { onSubscribed: () => {} };

export function configureRealtime(next: RealtimeDeps): void {
  deps = next;
}

let realtimeChannel: RealtimeChannel | null = null;

export function hasRealtimeChannel(): boolean {
  return realtimeChannel !== null;
}

export function teardownRealtime(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelayMs = 0;
  if (supabase && realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 0;

const REALTIME_RECONNECT_BASE_MS = 2_000;
const REALTIME_RECONNECT_MAX_MS = 60_000;

/**
 * Carries other devices' edits as they happen (spec: a task added on the phone
 * shows up on the desktop without anyone pressing anything).
 *
 * Two things make this trustworthy rather than best-effort. First, every
 * applied event is written to disk — an update that only lived in memory
 * vanished on the next restart and reappeared as a "difference". Second, a
 * dropped channel reconnects and then runs a full reconciliation, because
 * anything that changed while the socket was down was never delivered at all.
 */
/**
 * Run a realtime handler only for rows that actually came from its table.
 *
 * One channel carries six `postgres_changes` bindings that differ solely by
 * table name. When the server's binding ids and the client's list fall out of
 * step — a reconnect, a binding the project cannot serve — supabase-js fans a
 * payload out to handlers it was never meant for, and a `tasks` row arrives at
 * `handleRealtimeOccurrenceChange`. The mappers below are tolerant by design
 * (`row.task_id as string`, `?? null`), so instead of failing they mint a
 * plausible-looking occurrence with no `taskId` and no `date`. That row is
 * unreachable locally — nothing looks up an occurrence by bare task id — but
 * every later push sends it to a column declared NOT NULL, Postgres rejects
 * the batch, and the whole reconciliation dies. One stray payload is enough to
 * stop sync permanently, which is exactly what happened here.
 *
 * The payload carries the table it came from. Checking it costs nothing.
 */
function onlyFrom<P>(
  table: string,
  handle: (payload: P) => void,
): (payload: P & { table?: string }) => void {
  return (payload) => {
    if (payload.table !== undefined && payload.table !== table) {
      console.warn(
        `[tempo sync] realtime payload from "${payload.table}" was delivered to the "${table}" handler — ignored.`,
      );
      return;
    }
    applyRemote(() => handle(payload));
  };
}

const TABLE_HANDLERS: Record<string, (payload: RealtimeRowChange) => void> = {
  tasks: handleRealtimeTaskChange,
  categories: handleRealtimeCategoryChange,
  occurrences: handleRealtimeOccurrenceChange,
  reminders: handleRealtimeReminderChange,
  transactions: handleRealtimeTransactionChange,
  budget_categories: handleRealtimeBudgetCategoryChange,
};

export function setupRealtime(userId: string) {
  if (!supabase) return;
  const client = supabase;
  if (realtimeChannel) {
    client.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  useSyncStore.getState().setRealtime("connecting");

  const forUser = { schema: "public", filter: `user_id=eq.${userId}` } as const;
  const bound = Object.entries(TABLE_HANDLERS).reduce(
    (channel, [table, handle]) =>
      channel.on(
        "postgres_changes",
        { event: "*", table, ...forUser },
        onlyFrom(table, handle),
      ),
    client.channel(`user-sync-${userId}`) as RealtimeChannel,
  );

  realtimeChannel = bound.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      reconnectDelayMs = 0;
      useSyncStore.getState().setRealtime("connected");
      // Whatever happened while we were not listening was never delivered.
      deps.onSubscribed(userId);
      return;
    }
    if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      useSyncStore.getState().setRealtime("down");
      scheduleRealtimeReconnect(userId);
    }
  });
}

function scheduleRealtimeReconnect(userId: string): void {
  if (reconnectTimer) return;
  reconnectDelayMs =
    reconnectDelayMs === 0
      ? REALTIME_RECONNECT_BASE_MS
      : Math.min(reconnectDelayMs * 2, REALTIME_RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentUserId() === userId && isOnline()) setupRealtime(userId);
  }, reconnectDelayMs);
}

/**
 * Apply a cloud-originated change without echoing it back.
 *
 * The store subscriber cannot tell a remote write from a local one, so the flag
 * is what stops a realtime update from being queued straight back to the server
 * it just came from. The write is persisted here too: an event applied to
 * memory only is lost on the next restart.
 */
function applyRemote(mutate: () => void): void {
  beginRemoteApply();
  try {
    mutate();
  } finally {
    endRemoteApply();
  }
  persist(useStore.getState().db);
}

