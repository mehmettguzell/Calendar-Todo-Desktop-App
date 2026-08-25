import { create } from "zustand";
import type { BankAlert } from "@/domain/bankAlert";

/**
 * Purchases the bank has announced but the user has not yet accepted.
 *
 * Only used when the feed is set to ask first. It lives in memory rather than
 * in the document on purpose: the mailbox is the real queue, and the ledger's
 * high-water mark is only advanced once every message in a batch has been
 * either recorded or dismissed. Closing the app mid-review therefore loses
 * nothing — the next poll offers the same messages again.
 */

export interface FeedState {
  /** Waiting for a decision, oldest first. */
  pending: BankAlert[];
  /** Highest message id in the batch, held back until the queue drains. */
  batchUid: number | null;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  /** Recognised but not written, because the same purchase was already there. */
  lastMerged: number;
  lastRecorded: number;

  offer(alerts: BankAlert[], batchUid: number): void;
  resolve(externalId: string): void;
  clear(): void;
  setSyncing(syncing: boolean): void;
  setResult(patch: Partial<Pick<FeedState, "lastError" | "lastSyncAt" | "lastRecorded" | "lastMerged">>): void;
}

export const useSpendFeedStore = create<FeedState>((set) => ({
  pending: [],
  batchUid: null,
  syncing: false,
  lastError: null,
  lastSyncAt: null,
  lastMerged: 0,
  lastRecorded: 0,

  offer(alerts, batchUid) {
    set((state) => {
      const known = new Set(state.pending.map((alert) => alert.externalId));
      const fresh = alerts.filter((alert) => !known.has(alert.externalId));
      return {
        pending: [...state.pending, ...fresh],
        batchUid: Math.max(state.batchUid ?? 0, batchUid),
      };
    });
  },

  resolve(externalId) {
    set((state) => ({
      pending: state.pending.filter((alert) => alert.externalId !== externalId),
    }));
  },

  clear() {
    set({ pending: [], batchUid: null });
  },

  setSyncing(syncing) {
    set({ syncing });
  },

  setResult(patch) {
    set(patch);
  },
}));
