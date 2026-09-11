import type { SupabaseClient } from "@supabase/supabase-js";
import type { FocusSession, HistoryEntry, Task } from "@/domain/types";
import { supabase } from "@/lib/supabase";
import {
  dropOptionalColumn,
  optionalColumnCount,
  toFocusSessionRow,
  toHistoryRow,
  toTaskRow,
  withoutMissingColumns,
} from "@/data/dto";
import { withTimeout } from "./cloudRequest";
import { ensureProfileRow } from "./profile";
import { isMissingRelation, noteRelationMissing, tableAvailable } from "./schemaCapability";
import { warnUnsendable } from "./skippedRows";
import { syncedFocusIds, syncedHistoryIds } from "./syncedState";
import {
  type CollectionSpec,
  planReconciliation,
  type SyncContext,
} from "./reconcile";

/** Largest number of rows sent to PostgREST in a single request. */
export const UPSERT_CHUNK_SIZE = 500;

export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const serializeTaskForCloud = toTaskRow;

export async function upsertTasksToCloud(tasks: Task[], userId: string) {
  if (!supabase || !userId || tasks.length === 0) return { error: null };
  const client = supabase;

  const send = (batch: Task[]) =>
    withTimeout(
      client.from("tasks").upsert(
        batch.map((t) => serializeTaskForCloud(t, userId)),
        { onConflict: "id,user_id" },
      ),
      "task upsert",
    );

  // PostgREST has a request-size ceiling, so a large first sync must go up in
  // slices rather than as one giant body.
  for (const batch of chunked(tasks, UPSERT_CHUNK_SIZE)) {
    let res = await send(batch);

    // Each round trip names at most one unknown column, so give up on it and
    // try again — bounded by how many columns are optional in the first place.
    for (let i = 0; res.error && i < optionalColumnCount("tasks"); i += 1) {
      if (!dropOptionalColumn("tasks", res.error)) break;
      res = await send(batch);
    }

    if (
      res.error &&
      (res.error.message.includes("profiles") || res.error.code === "23503")
    ) {
      await ensureProfileRow(userId);
      res = await send(batch);
    }

    if (res.error) return res;
  }

  return { error: null };
}

// The I/O half of the reconciler; the decision half is `planReconciliation`.
/** Rows whose content actually changed, minus any the cloud would reject. */
function sendableRows<T>(spec: CollectionSpec<T>, rows: T[]): T[] {
  const changed = rows.filter(
    (row) => spec.synced.get(spec.idOf(row)) !== spec.localFingerprint(row),
  );
  if (!spec.isUploadable) return changed;
  return changed.filter((row) => {
    if (spec.isUploadable!(row)) return true;
    warnUnsendable(spec.table, spec.idOf(row));
    return false;
  });
}

/** True once the table turned out to be absent, so the caller should give up. */
async function upsertBatch<T>(
  client: SupabaseClient,
  spec: CollectionSpec<T>,
  batch: T[],
  userId: string,
): Promise<boolean> {
  const send = () =>
    withTimeout(
      client.from(spec.table).upsert(
        batch.map((row) =>
          withoutMissingColumns(spec.table, spec.toCloud(row, userId)),
        ),
        { onConflict: "id,user_id" },
      ),
      `${spec.table} upsert`,
    );

  let { error } = await send();
  // Each round trip names at most one unknown column, so give up on it and try
  // again, bounded by how many columns are optional in the first place.
  for (let i = 0; error && i < optionalColumnCount(spec.table); i += 1) {
    if (!dropOptionalColumn(spec.table, error)) break;
    ({ error } = await send());
  }

  if (isMissingRelation(error)) {
    noteRelationMissing(spec.table);
    return true;
  }
  if (error) throw error;
  for (const row of batch) {
    spec.synced.set(spec.idOf(row), spec.localFingerprint(row));
  }
  return false;
}

export async function writeCollection<T>(
  spec: CollectionSpec<T>,
  rows: T[],
  deletedIds: string[],
  userId: string,
): Promise<void> {
  if (!supabase || !tableAvailable(spec.table)) return;
  const client = supabase;

  for (const batch of chunked(sendableRows(spec, rows), UPSERT_CHUNK_SIZE)) {
    if (await upsertBatch(client, spec, batch, userId)) return;
  }

  if (deletedIds.length === 0) return;
  const { error } = await withTimeout(
    client
      .from(spec.table)
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .in("id", deletedIds)
      .eq("user_id", userId),
    `${spec.table} delete`,
  );
  if (isMissingRelation(error)) {
    noteRelationMissing(spec.table);
    return;
  }
  if (error) throw error;
  for (const id of deletedIds) spec.synced.delete(id);
}

/** Apply `planReconciliation`, pushing whatever the local side won. */
export async function reconcileCollection<T>(
  spec: CollectionSpec<T>,
  local: T[],
  cloud: { data: Record<string, unknown>[] | null },
  tombstoned: Set<string>,
  context: SyncContext,
  userId: string,
): Promise<T[]> {
  const plan = planReconciliation(spec, local, cloud, tombstoned, context);
  if (plan.unchanged) return local;
  await writeCollection(spec, plan.toUpload, [], userId);
  return plan.merged;
}

/**
 * Append the activity trail.
 *
 * Immutable by contract, so this only ever inserts. Nothing here can conflict,
 * which is why it needs none of the reconciliation the other tables do.
 */
export async function writeHistory(
  entries: HistoryEntry[],
  userId: string,
): Promise<void> {
  if (!supabase || entries.length === 0 || !tableAvailable("task_history"))
    return;

  for (const batch of chunked(entries, UPSERT_CHUNK_SIZE)) {
    const { error } = await withTimeout(
      supabase.from("task_history").upsert(
        batch.map((h) => toHistoryRow(h, userId)),
        { onConflict: "id,user_id" },
      ),
      "history upsert",
    );
    if (isMissingRelation(error)) {
      noteRelationMissing("task_history");
      return;
    }
    if (error) throw error;
    for (const h of batch) syncedHistoryIds.add(h.id);
  }
}

export async function writeFocusSessions(
  sessions: FocusSession[],
  userId: string,
): Promise<void> {
  if (!supabase || sessions.length === 0) return;
  for (const batch of chunked(sessions, UPSERT_CHUNK_SIZE)) {
    const { error } = await withTimeout(
      supabase.from("focus_sessions").upsert(
        batch.map((f) => toFocusSessionRow(f, userId)),
        { onConflict: "id,user_id" },
      ),
      "focus upsert",
    );
    if (error) throw error;
    for (const f of batch) syncedFocusIds.add(f.id);
  }
}

