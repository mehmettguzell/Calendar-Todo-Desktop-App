import type { FocusSession } from "@/domain/types";

/**
 * Focus rows never change after insert, so they carry no fingerprint — an id
 * the cloud lacks is the whole diff.
 */
export function toFocusSessionRow(
  f: FocusSession,
  userId: string,
): Record<string, unknown> {
  return {
    id: f.id,
    user_id: userId,
    task_id: f.taskId || null,
    started_at: f.startedAt,
    duration_sec: f.durationSec,
    notes: null,
  };
}

export function focusSessionFromRow(
  row: Record<string, unknown>,
): FocusSession {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    occurrenceDate: null,
    startedAt: row.started_at as string,
    endedAt: null,
    durationSec: row.duration_sec as number,
  };
}
