/**
 * The decision half of the reconciler. Pure — no I/O.
 *
 * Occurrences, reminders, transactions, budget categories, wishlist, deadlines
 * and statement batches all reconcile the same way: compare by content, and
 * when the two sides genuinely differ let the greater `updated_at` win, with
 * ties going to the cloud so every device reaches the same answer. The rule is
 * kept separate from the write precisely so it can be tested as a rule, without
 * a network in the way — it is the part most likely to be wrong and hardest to
 * notice when it is.
 */

/**
 * One description of how a collection crosses the wire. The differences between
 * the tables live in these tables of functions; the logic lives once.
 */
export interface CollectionSpec<T> {
  table: string;
  idOf(row: T): string;
  localFingerprint(row: T): string;
  cloudFingerprint(row: Record<string, unknown>): string;
  updatedAtOf(row: T): string;
  toCloud(row: T, userId: string): Record<string, unknown>;
  fromCloud(row: Record<string, unknown>): T;
  /** Cloud rows that reference something this device no longer has. */
  isOrphan?(row: Record<string, unknown>, context: SyncContext): boolean;
  /**
   * Whether a local row is structurally fit to be sent.
   *
   * A row that violates a NOT NULL or CHECK constraint is rejected by Postgres
   * for the whole batch, so one corrupt row stops every other collection from
   * syncing too — and keeps doing so on every retry, forever. Dropping it from
   * the push instead keeps the damage to the row that is actually broken.
   */
  isUploadable?(row: T): boolean;
  /** What the cloud is believed to hold, so unchanged rows are never re-sent. */
  synced: Map<string, string>;
}

export interface SyncContext {
  liveTaskIds: Set<string>;
}

export function planReconciliation<T>(
  spec: CollectionSpec<T>,
  local: T[],
  cloud: { data: Record<string, unknown>[] | null },
  tombstoned: Set<string>,
  context: SyncContext,
): { merged: T[]; toUpload: T[]; unchanged: boolean } {
  if (!cloud.data) return { merged: local, toUpload: [], unchanged: true };

  const merged = new Map(local.map((row) => [spec.idOf(row), row]));
  const toUpload: T[] = [];
  const cloudById = new Map(cloud.data.map((row) => [row.id as string, row]));

  for (const localRow of local) {
    const id = spec.idOf(localRow);
    const cloudRow = cloudById.get(id);
    if (!cloudRow) {
      toUpload.push(localRow);
      continue;
    }
    if (spec.cloudFingerprint(cloudRow) === spec.localFingerprint(localRow))
      continue;

    const cloudWins =
      new Date(cloudRow.updated_at as string).getTime() >=
      new Date(spec.updatedAtOf(localRow)).getTime();
    if (cloudWins) merged.set(id, spec.fromCloud(cloudRow));
    else toUpload.push(localRow);
  }

  for (const cloudRow of cloud.data) {
    const id = cloudRow.id as string;
    if (merged.has(id) || cloudRow.is_deleted || tombstoned.has(id)) continue;
    if (spec.isOrphan?.(cloudRow, context)) continue;
    merged.set(id, spec.fromCloud(cloudRow));
  }

  return { merged: Array.from(merged.values()), toUpload, unchanged: false };
}
