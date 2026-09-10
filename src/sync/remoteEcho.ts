/**
 * Whether a row arriving on the realtime channel may overwrite what is here.
 *
 * Every write this device makes comes straight back to it as an echo — the
 * channel does not distinguish "someone else changed this" from "you did". Two
 * echoes used to do real damage: the echo of a Trash purge re-inserted the
 * task, and the echo of an in-flight write reverted a newer local edit.
 *
 * Hence the order: a purge here is a decision and outranks anything the cloud
 * says; a queued local write is newer than any echo by construction; otherwise
 * the ordinary rule applies — last write wins on `updated_at`, ties to the
 * cloud (DECISIONS.md §11).
 */
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
  // Nothing to show and nothing to restore: a trashed row this device does not
  // have is either its own purge coming home or another device deleting
  // something already gone from here.
  if (input.localUpdatedAt === null && input.remoteDeleted) return false;
  if (
    input.localUpdatedAt !== null &&
    input.localUpdatedAt > input.remoteUpdatedAt
  ) {
    return false;
  }
  return true;
}
