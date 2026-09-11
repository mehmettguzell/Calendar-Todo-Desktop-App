import { persist } from "@/data/localDocument";
import { installPorts } from "@/sync/ports";
import { useAuthStore } from "./authStore";
import { useStore } from "./store";
import { isOnline, useSyncStore } from "./syncStore";
import { UNDO_WINDOW_MS, useUndoStore } from "./undoStore";

/** Enough to backfill a `profiles` row; the session fills in for a missing row. */
/* eslint-disable-next-line complexity -- a flat defaulting map, not branching */
function authIdentity(): { email: string; fullName: string } {
  const state = useAuthStore.getState();
  const email = state.user?.email ?? state.session?.user?.email ?? "";
  return {
    email,
    fullName:
      state.user?.fullName ??
      (state.session?.user?.user_metadata?.full_name as string) ??
      email.split("@")[0] ??
      "User",
  };
}

/**
 * The one place that says which store answers the sync engine's ports.
 *
 * Everything under `src/sync/` talks to interfaces; this module is the only
 * file that knows they are Zustand stores. Keeping it separate is what lets the
 * engine be driven by fakes in a test, and eventually by a different client.
 */
export function wireSyncPorts(): void {
  installPorts({
    status: {
      setPhase: (phase, failure) => useSyncStore.getState().setPhase(phase, failure),
      setPending: (count) => useSyncStore.getState().setPending(count),
      setRetry: (attempt, paused) => useSyncStore.getState().setRetry(attempt, paused),
      setRealtime: (state) => useSyncStore.getState().setRealtime(state),
      noteSkipped: (row) => useSyncStore.getState().noteSkipped(row),
      clearSkipped: () => useSyncStore.getState().clearSkipped(),
      markSynced: () => useSyncStore.getState().markSynced(),
      currentPhase: () => useSyncStore.getState().phase,
      lastFailure: () => useSyncStore.getState().lastFailure,
      retryPaused: () => useSyncStore.getState().autoRetryPaused,
      realtimeState: () => useSyncStore.getState().realtime,
      isOnline,
    },

    auth: {
      // `user` is the `public.profiles` row and can be null for a while, or
      // forever if that fetch failed, so the session is the fallback.
      currentUserId: () => {
        const state = useAuthStore.getState();
        return state.user?.id ?? state.session?.user?.id ?? null;
      },
      identity: authIdentity,
      onAccountChange: (handle) => {
        useAuthStore.subscribe((state, previous) => {
          const before = previous.user?.id ?? previous.session?.user?.id ?? null;
          const after = state.user?.id ?? state.session?.user?.id ?? null;
          if (after !== before) handle(after);
        });
      },
    },

    document: {
      read: () => useStore.getState().db,
      apply: (next) => useStore.setState((state) => ({ db: next(state.db) })),
      flush: () => persist(useStore.getState().db),
      subscribe: (handle) => {
        useStore.subscribe((state, previous) => handle(state.db, previous.db));
      },
      switchAccount: (userId) => useStore.getState().switchAccount(userId),
      undoOfferExpiresAt: () => {
        const offer = useUndoStore.getState().pending;
        return offer ? offer.at + UNDO_WINDOW_MS : null;
      },
    },
  });
}
