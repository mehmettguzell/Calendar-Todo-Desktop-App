import { create } from "zustand";
import type { SyncFailureKind } from "@/lib/errors";

/**
 * What the sync layer is currently doing, as something the UI can render.
 *
 * Sync fails for ordinary, temporary reasons — a train tunnel, a laptop lid, a
 * Supabase project that is asleep. None of those are errors the user should
 * have to interpret from a stalled spinner, and none of them should block the
 * app: local writes always succeed. This store is how that shows up on screen.
 *
 * Note what is *not* here: the raw error text. Backend messages name tables,
 * columns and constraints, so the engine classifies the failure and the UI
 * picks a sentence for the kind. The detail stays in the console.
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
  /** Category of the last failure, if any. Never raw backend text. */
  lastFailure: SyncFailureKind | null;
  /** Rows edited locally that the cloud has not confirmed yet. */
  pendingWrites: number;
  /** Automatic attempts spent since the last success. */
  retryAttempt: number;
  /**
   * The retry budget is spent: nothing further happens on its own, and sync
   * waits for a condition — coming back online, the window being focused, or
   * the user pressing the button.
   */
  autoRetryPaused: boolean;
  /** Whether the realtime channel is currently carrying other devices' edits. */
  realtime: "connected" | "connecting" | "down";

  setPhase(phase: SyncPhase, failure?: SyncFailureKind | null): void;
  setPending(count: number): void;
  setRetry(attempt: number, paused: boolean): void;
  setRealtime(state: SyncState["realtime"]): void;
  markSynced(): void;
}

export const useSyncStore = create<SyncState>((set) => ({
  phase: "disabled",
  lastSyncedAt: null,
  lastFailure: null,
  pendingWrites: 0,
  retryAttempt: 0,
  autoRetryPaused: false,
  realtime: "down",

  setPhase: (phase, failure = null) =>
    set((s) => ({
      phase,
      // A successful pass clears the old failure; a failure keeps its reason
      // visible until something actually works again.
      lastFailure: phase === "error" ? (failure ?? s.lastFailure) : null,
    })),
  setPending: (pendingWrites) => set({ pendingWrites }),
  setRetry: (retryAttempt, autoRetryPaused) => set({ retryAttempt, autoRetryPaused }),
  setRealtime: (realtime) => set({ realtime }),
  markSynced: () =>
    set({
      phase: "idle",
      lastFailure: null,
      lastSyncedAt: Date.now(),
      retryAttempt: 0,
      autoRetryPaused: false,
    }),
}));

/** `true` when the browser believes it has a network. Pessimistic by design. */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
