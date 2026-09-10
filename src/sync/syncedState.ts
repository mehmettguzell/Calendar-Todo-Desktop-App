// What the cloud is believed to hold, keyed by row id. Every path that learns
// the cloud's content records the fingerprint here so unchanged rows are never re-sent.

export const syncedTaskFingerprints = new Map<string, string>();
export const syncedCategoryFingerprints = new Map<string, string>();
export const syncedOccurrenceFingerprints = new Map<string, string>();
export const syncedReminderFingerprints = new Map<string, string>();
export const syncedTransactionFingerprints = new Map<string, string>();
export const syncedBudgetCategoryFingerprints = new Map<string, string>();
export const syncedWishlistFingerprints = new Map<string, string>();
export const syncedDeadlineFingerprints = new Map<string, string>();
export const syncedBatchFingerprints = new Map<string, string>();

// Append-only tables need only an id set — no fingerprint, nothing to compare.
export const syncedFocusIds = new Set<string>();
export const syncedHistoryIds = new Set<string>();

/** Drop every believed-cloud fingerprint (account change, or after a full pass). */
export function forgetSyncedState(): void {
  syncedTaskFingerprints.clear();
  syncedCategoryFingerprints.clear();
  syncedOccurrenceFingerprints.clear();
  syncedReminderFingerprints.clear();
  syncedTransactionFingerprints.clear();
  syncedBudgetCategoryFingerprints.clear();
  syncedWishlistFingerprints.clear();
  syncedDeadlineFingerprints.clear();
  syncedBatchFingerprints.clear();
  syncedFocusIds.clear();
  syncedHistoryIds.clear();
}
