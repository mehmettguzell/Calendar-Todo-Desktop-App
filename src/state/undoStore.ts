import { create } from "zustand";

/**
 * The last thing that can be taken back.
 *
 * Deliberately one deep. A full undo stack over a document that also changes
 * from another device is a promise this app cannot keep — replaying the third
 * step back after the phone has edited the same row does not undo anything, it
 * invents a state nobody was ever in. One step, offered immediately, covers
 * what undo is actually for: the click you regret the moment you make it.
 *
 * Each action carries its own reversal rather than the store diffing snapshots,
 * so undoing a delete is `restoreTask` — the same code path the Trash uses, with
 * the same history entry — and not a resurrection that skips it.
 */
export interface UndoableAction {
  id: string;
  /** Shown in the toast: "Görev silindi". Already translated by the caller. */
  label: string;
  at: number;
  undo(): void;
}

/** How long the offer stays on screen. Long enough to notice, short enough
 * that it is gone before it becomes furniture. */
export const UNDO_WINDOW_MS = 8000;

interface UndoState {
  pending: UndoableAction | null;
  push(label: string, undo: () => void): void;
  /** Run the pending reversal, if there still is one. */
  undo(): boolean;
  dismiss(id?: string): void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  pending: null,

  push: (label, undo) =>
    set({
      pending: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        at: Date.now(),
        undo,
      },
    }),

  undo: () => {
    const pending = get().pending;
    if (!pending) return false;
    // Cleared first: the reversal is itself a store mutation, and an action
    // that offered to undo its own undo would be a loop with a button on it.
    set({ pending: null });
    pending.undo();
    return true;
  },

  // An id makes the timeout safe: a toast that has already been replaced by a
  // newer action must not dismiss the newer one when its own timer fires.
  dismiss: (id) =>
    set((s) => (!id || s.pending?.id === id ? { pending: null } : s)),
}));
