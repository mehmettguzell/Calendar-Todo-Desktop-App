import type { Task } from "@/domain/types";
import { localTaskFingerprint } from "@/data/dto";

// What a flush sends per queued task: upsert, mark-deleted, or forget (created
// and trashed before the cloud saw it). `synced` = ids the cloud already knows.
export function planTaskWrites(input: {
  /** Ids the queue holds. */
  queued: string[];
  /** Ids queued as purges (a tombstone, not a soft delete). */
  deleted: string[];
  taskById: Map<string, Task>;
  /** id -> the fingerprint last written to the cloud. */
  synced: ReadonlyMap<string, string>;
}): { upsert: string[]; markDeleted: string[]; forget: Set<string> } {
  const { queued, deleted, taskById, synced } = input;
  const purged = new Set(deleted);

  const forget = new Set<string>();
  for (const id of [...queued, ...deleted]) {
    if (synced.has(id)) continue;
    const task = taskById.get(id);
    if (!task || task.deletedAt !== null) forget.add(id);
  }

  const upsert: string[] = [];
  for (const id of queued) {
    if (purged.has(id) || forget.has(id)) continue;
    const task = taskById.get(id);
    if (!task) continue;
    if (synced.get(id) === localTaskFingerprint(task)) continue;
    upsert.push(id);
  }

  const markDeleted = deleted.filter((id) => !forget.has(id));
  return { upsert, markDeleted, forget };
}
