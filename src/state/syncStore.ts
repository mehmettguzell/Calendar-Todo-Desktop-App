import { create } from "zustand";

/**
 * What the sync layer is currently doing, as something the UI can render.
 *
 * Sync fails for ordinary, temporary reasons — a train tunnel, a laptop lid, a
 * Supabase project that is asleep. None of those are errors the user should
 * have to interpret from a stalled spinner, and none of them should block the
 * app: local writes always succeed. This store is how that shows up on screen.
 */
export type SyncPhase =
  | "idle"
  | "syncing"
  | "offline"
  /** The last attempt failed; local edits are queued and will be retried. */
  | "error"
  /** Signed out, or Supabase is not configured. Purely local operation. */
  | "disabled";

export interface SyncState {
  phase: SyncPhase;
  /** Local milliseconds of the last fully successful reconciliation. */
  lastSyncedAt: number | null;
  /** Human-readable reason the last attempt failed, if it did. */
  lastError: string | null;
  /** Rows edited locally that the cloud has not confirmed yet. */
  pendingWrites: number;
  /** Whether the realtime channel is currently carrying other devices' edits. */
  realtime: "connected" | "connecting" | "down";

  setPhase(phase: SyncPhase, error?: string | null): void;
  setPending(count: number): void;
  setRealtime(state: SyncState["realtime"]): void;
  markSynced(): void;
}

export const useSyncStore = create<SyncState>((set) => ({
  phase: "disabled",
  lastSyncedAt: null,
  lastError: null,
  pendingWrites: 0,
  realtime: "down",

  setPhase: (phase, error = null) =>
    set((s) => ({
      phase,
      // A successful pass clears the old failure; a failure keeps its reason
      // visible until something actually works again.
      lastError: phase === "error" ? (error ?? s.lastError) : null,
    })),
  setPending: (pendingWrites) => set({ pendingWrites }),
  setRealtime: (realtime) => set({ realtime }),
  markSynced: () =>
    set({ phase: "idle", lastError: null, lastSyncedAt: Date.now() }),
}));

/** `true` when the browser believes it has a network. Pessimistic by design. */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
