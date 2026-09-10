import type { HistoryEntry } from "@/domain/types";

/**
 * The activity trail is append-only (spec 5.5): an entry is never rewritten, so
 * ids alone are the whole diff and no fingerprint is needed.
 */
export function toHistoryRow(
  h: HistoryEntry,
  userId: string,
): Record<string, unknown> {
  return {
    id: h.id,
    user_id: userId,
    task_id: h.taskId,
    at: h.at,
    kind: h.kind,
    occurrence_date: h.occurrenceDate,
    field: h.field,
    from_value: h.from,
    to_value: h.to,
    note: h.note,
  };
}

export function historyFromRow(row: Record<string, unknown>): HistoryEntry {
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
