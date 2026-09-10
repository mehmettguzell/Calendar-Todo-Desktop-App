import type { Task } from "@/domain/types";
import { localTaskFingerprint } from "@/data/dto";

/**
 * What a flush should actually send about the tasks it has queued.
 *
 * Three answers, and the third is the one that is easy to miss: some rows
 * should be dropped entirely rather than written. Adding a task and then
 * thinking better of it used to cost two requests — an upsert carrying a row
 * whose only content was `is_deleted`, and an insert carrying that row's
 * history — for a task the server had never seen.
 *
 * `synced` is the record of what has actually been written, so "not in
 * `synced`" means the cloud has never heard of this id. A pure function of four
 * values, because a rule about *not* making a request cannot be observed by
 * watching requests.
 */
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
    // A purge leaves no row behind at all, so `taskById` may not have it.
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
