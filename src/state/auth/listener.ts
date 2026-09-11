/**
 * The single auth-change listener, kept so `initAuth` stays idempotent.
 *
 * Held at module scope rather than in the store because it is a property of the
 * Supabase client — itself a module-level singleton — not of React-visible state.
 */
let listener: { unsubscribe: () => void } | null = null;

export function hasAuthListener(): boolean {
  return listener !== null;
}

export function keepAuthListener(next: { unsubscribe: () => void }): void {
  listener = next;
}

/** Release it. Only tests need this; the app holds the listener for life. */
export function disposeAuthListener(): void {
  listener?.unsubscribe();
  listener = null;
}
