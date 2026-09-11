import type { Occurrence } from "@/domain/types";
import { nz, nzInstant } from "./rowValues";

export function toOccurrenceRow(
  o: Occurrence,
  userId: string,
): Record<string, unknown> {
  return {
    id: o.id,
    user_id: userId,
    task_id: o.taskId,
    date: o.date,
    status: o.status,
    completed_at: o.completedAt,
    snoozed_until: o.snoozedUntil,
    is_deleted: false,
    updated_at: o.updatedAt,
  };
}

export function occurrenceFromRow(row: Record<string, unknown>): Occurrence {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    date: row.date as string,
    status: (row.status as Occurrence["status"]) ?? "TODO",
    completedAt: (row.completed_at as string) ?? null,
    snoozedUntil: (row.snoozed_until as string) ?? null,
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export function localOccurrenceFingerprint(o: Occurrence): string {
  return JSON.stringify([
    o.taskId,
    o.date,
    o.status,
    nzInstant(o.completedAt),
    nz(o.snoozedUntil),
  ]);
}

export function cloudOccurrenceFingerprint(
  row: Record<string, unknown>,
): string {
  return JSON.stringify([
    row.task_id,
    row.date,
    row.status,
    nzInstant(row.completed_at),
    nz(row.snoozed_until),
  ]);
}
