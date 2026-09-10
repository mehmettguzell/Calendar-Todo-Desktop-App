// The decision half of the reconciler, pure so the rule can be tested as a
// rule. Row-level last-write-wins on `updated_at`, ties to the cloud. DECISIONS.md §11.

// How one collection crosses the wire; the per-table differences live here.
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
  // Structurally fit to send? One row that breaks a NOT NULL / CHECK fails the
  // whole batch, so a broken row is dropped rather than retried forever.
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
