import type { Reminder } from "@/domain/types";
import { nz, nzInstant } from "./rowValues";

export function toReminderRow(
  r: Reminder,
  userId: string,
): Record<string, unknown> {
  return {
    id: r.id,
    user_id: userId,
    task_id: r.taskId,
    kind: r.kind,
    offset_minutes: r.offsetMinutes,
    remind_at: r.remindAt,
    status: r.status,
    snoozed_until: r.snoozedUntil,
    last_fired_for: r.lastFiredFor,
    is_deleted: false,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function reminderFromRow(row: Record<string, unknown>): Reminder {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    kind: (row.kind as Reminder["kind"]) ?? "RELATIVE",
    offsetMinutes: (row.offset_minutes as number) ?? null,
    remindAt: (row.remind_at as string) ?? null,
    status: (row.status as Reminder["status"]) ?? "PENDING",
    snoozedUntil: (row.snoozed_until as string) ?? null,
    lastFiredFor: (row.last_fired_for as string) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export function localReminderFingerprint(r: Reminder): string {
  return JSON.stringify([
    r.taskId,
    r.kind,
    r.offsetMinutes ?? null,
    nzInstant(r.remindAt),
    r.status,
    nz(r.snoozedUntil),
    nz(r.lastFiredFor),
  ]);
}

export function cloudReminderFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.task_id,
    row.kind,
    row.offset_minutes ?? null,
    nzInstant(row.remind_at),
    row.status,
    nz(row.snoozed_until),
    nz(row.last_fired_for),
  ]);
}
