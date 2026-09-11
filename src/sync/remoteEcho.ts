// May a realtime row overwrite what is here? Tombstone and queued local write
// block it; otherwise last-write-wins on `updated_at`, ties to cloud. DECISIONS.md §11.
export function acceptsRemoteTask(input: {
  remoteUpdatedAt: string;
  remoteDeleted: boolean;
  /** `null` when this device has no such row. */
  localUpdatedAt: string | null;
  tombstoned: boolean;
  queued: boolean;
}): boolean {
  if (input.tombstoned) return false;
  if (input.queued) return false;
  // A trashed row this device never had: its own purge coming home.
  if (input.localUpdatedAt === null && input.remoteDeleted) return false;
  if (
    input.localUpdatedAt !== null &&
    input.localUpdatedAt > input.remoteUpdatedAt
  ) {
    return false;
  }
  return true;
}
