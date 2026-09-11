
// Losing the network never signs anyone out — the app stays signed in and keeps
// writing locally. When it returns, one reconciliation pass catches the cloud up.
import { status } from "./ports";

interface ConnectivityDeps {
  currentUserId(): string | null;
  resetRetryBudget(): void;
  drainQueuedWrites(): Promise<void> | void;
  setupRealtime(userId: string): void;
  hasRealtimeChannel(): boolean;
  requestSync(): void;
}

const VISIBILITY_COOLDOWN_MS = 60_000;

export function watchConnectivity(deps: ConnectivityDeps): void {
  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    deps.resetRetryBudget();
    const id = deps.currentUserId();
    if (!id) return;
    console.info("[tempo sync] back online — reconciling");
    if (!deps.hasRealtimeChannel()) deps.setupRealtime(id);
    deps.requestSync();
  });

  window.addEventListener("offline", () => {
    status().setPhase("offline");
    status().setRealtime("down");
  });

  if (typeof document === "undefined") return;
  let lastVisibilitySyncAt = 0;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      // The lid closing mid-window would leave the edit for the next launch.
      void deps.drainQueuedWrites();
      return;
    }
    const id = deps.currentUserId();
    if (!id || !status().isOnline()) return;

    const now = Date.now();
    if (now - lastVisibilitySyncAt < VISIBILITY_COOLDOWN_MS) return;

    const paused = status().retryPaused();
    if (paused) deps.resetRetryBudget();
    if (paused || status().realtimeState() !== "connected") {
      lastVisibilitySyncAt = now;
      deps.setupRealtime(id);
      deps.requestSync();
    }
  });
}
