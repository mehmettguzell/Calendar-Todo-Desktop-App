import type { SupabaseClient } from "@supabase/supabase-js";
import type { FocusSession, HistoryEntry } from "@/domain/types";
import { withTimeout } from "./cloudRequest";
import { chunked, UPSERT_CHUNK_SIZE, writeFocusSessions, writeHistory } from "./cloudWrites";
import type { OptionalRows } from "./cloudSnapshot";

export interface FocusMergeInput {
  client: SupabaseClient;
  userId: string;
  local: FocusSession[];
  cloud: Record<string, unknown>[];
  tombstoned: Set<string>;
  incremental: boolean;
}

function focusFromRow(row: Record<string, unknown>): FocusSession {
  return {
    id: row.id as string,
    taskId: row.task_id as FocusSession["taskId"],
    occurrenceDate: null,
    startedAt: row.started_at as string,
    endedAt: null,
    durationSec: row.duration_sec as number,
  };
}

/**
 * Focus rows are hard-deleted rather than flagged, so a deletion made
 * elsewhere is invisible to an incremental read — both directions wait for a
 * full pass.
 */
export async function mergeFocusSessions(
  input: FocusMergeInput,
): Promise<FocusSession[]> {
  const cloudIds = new Set(input.cloud.map((f) => f.id as string));
  const toUpload = input.incremental
    ? []
    : input.local.filter(
        (f) => !cloudIds.has(f.id) && !input.tombstoned.has(f.id),
      );
  if (toUpload.length > 0) await writeFocusSessions(toUpload, input.userId);

  const localById = new Map(input.local.map((f) => [f.id, f]));
  const merged = [...input.local];
  const retire: string[] = [];

  for (const row of input.cloud) {
    const id = row.id as string;
    if (input.tombstoned.has(id)) {
      retire.push(id);
      continue;
    }
    if (localById.has(id)) continue;
    const session = focusFromRow(row);
    merged.push(session);
    localById.set(id, session);
  }

  for (const batch of chunked(retire, UPSERT_CHUNK_SIZE)) {
    await withTimeout(
      input.client
        .from("focus_sessions")
        .delete()
        .in("id", batch)
        .eq("user_id", input.userId),
      "focus sessions tombstone push",
    );
  }
  return merged;
}

function historyFromTrailRow(row: Record<string, unknown>): HistoryEntry {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    at: row.at as string,
    kind: row.kind as HistoryEntry["kind"],
    occurrenceDate: (row.occurrence_date as string) ?? null,
    field: (row.field as string) ?? null,
    from: (row.from_value as string) ?? null,
    to: (row.to_value as string) ?? null,
    note: (row.note as string) ?? null,
  };
}

/**
 * Append-only in both directions. Only the newest hundred entries are fetched,
 * so "missing from the cloud" is only meaningful inside that window — testing
 * the whole local trail against it re-uploaded every older entry every pass.
 */
export async function mergeHistory(
  local: HistoryEntry[],
  cloud: OptionalRows,
  userId: string,
): Promise<HistoryEntry[]> {
  if (!cloud.data) return local;

  const cloudIds = new Set(cloud.data.map((h) => h.id as string));
  const oldestCloudAt = cloud.data.reduce<string | null>((oldest, row) => {
    const at = row.at as string;
    return oldest === null || at < oldest ? at : oldest;
  }, null);

  await writeHistory(
    local.filter(
      (h) =>
        !cloudIds.has(h.id) &&
        (oldestCloudAt === null || h.at >= oldestCloudAt),
    ),
    userId,
  );

  const byId = new Map(local.map((h) => [h.id, h]));
  for (const row of cloud.data) {
    const id = row.id as string;
    if (!byId.has(id)) byId.set(id, historyFromTrailRow(row));
  }
  return Array.from(byId.values()).sort((a, b) => a.at.localeCompare(b.at));
}
