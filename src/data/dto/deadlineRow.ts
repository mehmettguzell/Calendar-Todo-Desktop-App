import { normaliseLabel, type Deadline } from "@/domain/deadline";
import { nz } from "./rowValues";

export function toDeadlineRow(
  d: Deadline,
  userId: string,
): Record<string, unknown> {
  return {
    id: d.id,
    user_id: userId,
    task_id: d.taskId,
    label: d.label,
    date: d.date,
    completed_at: d.completedAt,
    sort_order: d.order,
    is_deleted: d.deletedAt !== null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

export function deadlineFromRow(row: Record<string, unknown>): Deadline {
  const at = new Date().toISOString();
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    // Trimmed here as well as on the way in: another device wrote this.
    label: normaliseLabel(String(row.label ?? "")) ?? "",
    date: String(row.date ?? ""),
    completedAt: (row.completed_at as string) ?? null,
    order: Number(row.sort_order) || 0,
    createdAt: (row.created_at as string) ?? at,
    updatedAt: (row.updated_at as string) ?? at,
    deletedAt: row.is_deleted ? ((row.updated_at as string) ?? at) : null,
  };
}

export function localDeadlineFingerprint(d: Deadline): string {
  return JSON.stringify([
    d.taskId,
    d.label,
    d.date,
    nz(d.completedAt),
    d.order,
    d.deletedAt !== null,
  ]);
}

export function cloudDeadlineFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    String(row.task_id ?? ""),
    String(row.label ?? ""),
    String(row.date ?? ""),
    nz(row.completed_at),
    Number(row.sort_order) || 0,
    Boolean(row.is_deleted),
  ]);
}
