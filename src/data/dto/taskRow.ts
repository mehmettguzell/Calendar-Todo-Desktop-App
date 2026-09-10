import type { Task } from "@/domain/types";
import { canonicalRecurrence, nz, nzInstant } from "./rowValues";
import { columnDropped, withoutMissingColumns } from "./optionalColumns";

/**
 * A task as `public.tasks` stores it.
 *
 * Device-local fields (`order`, `manualOrder`) are absent by design: where a
 * row sits on one screen is not a fact about the task.
 */
export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  parent_id: string | null;
  priority: string;
  status: string;
  tags: string[];
  due_date: string | null;
  end_date?: string | null;
  deadline?: string | null;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  recurrence: unknown;
  estimate_minutes: number | null;
  snoozed_until: string | null;
  completed_at: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * The payload an upsert sends. Columns the project turned out not to have are
 * stripped here — PostgREST rejects the whole batch over one unknown key, and a
 * task manager that stops syncing because a migration was skipped is worse than
 * one that syncs everything except an estimate.
 */
export function toTaskRow(task: Task, userId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: task.id,
    user_id: userId,
    title: task.title,
    description: task.description || null,
    category_id: task.categoryId || null,
    parent_id: task.parentId || null,
    priority: task.priority,
    status: task.status,
    tags: task.tags,
    due_date: task.dueDate || null,
    all_day: task.allDay,
    start_time: task.startTime || null,
    end_time: task.endTime || null,
    recurrence: task.recurrence || null,
    estimate_minutes: task.estimateMinutes ?? null,
    snoozed_until: task.snoozedUntil || null,
    completed_at: task.completedAt || null,
    is_deleted: task.deletedAt !== null,
    created_at: task.createdAt,
    updated_at: task.updatedAt || new Date().toISOString(),
  };

  if (task.endDate) {
    payload.end_date = task.endDate;
  }

  if (task.deadline) {
    payload.deadline = task.deadline;
  }

  return withoutMissingColumns("tasks", payload);
}

export function taskFromRow(
  row: Record<string, unknown>,
  order: number,
  manualOrder: number | null,
): Task {
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    categoryId: (row.category_id as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    priority: (row.priority as Task["priority"]) ?? "NONE",
    status: (row.status as Task["status"]) ?? "TODO",
    tags: (row.tags as string[]) ?? [],
    dueDate: (row.due_date as string) ?? null,
    endDate: (row.end_date as string) ?? null,
    deadline: (row.deadline as string) ?? null,
    allDay: Boolean(row.all_day),
    startTime: (row.start_time as string) ?? null,
    endTime: (row.end_time as string) ?? null,
    recurrence: (row.recurrence as Task["recurrence"]) ?? null,
    estimateMinutes: (row.estimate_minutes as number) ?? null,
    snoozedUntil: (row.snoozed_until as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    deletedAt: row.is_deleted ? ((row.updated_at as string) ?? null) : null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    order,
    manualOrder,
  };
}

/**
 * A stable digest of every field the sync engine writes to the cloud.
 *
 * Two rows with the same fingerprint are identical as far as sync is concerned.
 * `created_at` and `updated_at` are excluded: `updated_at` is the conflict
 * tie-breaker, not part of the content.
 */
function taskFingerprint(fields: unknown[]): string {
  return JSON.stringify(fields);
}

export function localTaskFingerprint(task: Task): string {
  return taskFingerprint([
    nz(task.title),
    nz(task.description),
    nz(task.categoryId),
    nz(task.parentId),
    nz(task.priority),
    nz(task.status),
    (task.tags ?? []).map(String),
    nz(task.dueDate),
    columnDropped("tasks", "end_date") ? null : nz(task.endDate),
    columnDropped("tasks", "deadline") ? null : nz(task.deadline),
    Boolean(task.allDay),
    nz(task.startTime),
    nz(task.endTime),
    canonicalRecurrence(task.recurrence),
    columnDropped("tasks", "estimate_minutes")
      ? null
      : (task.estimateMinutes ?? null),
    nz(task.snoozedUntil),
    nzInstant(task.completedAt),
    task.deletedAt !== null,
  ]);
}

export function cloudTaskFingerprint(row: Record<string, unknown>): string {
  return taskFingerprint([
    nz(row.title),
    nz(row.description),
    nz(row.category_id),
    nz(row.parent_id),
    nz(row.priority),
    nz(row.status),
    ((row.tags as string[] | null) ?? []).map(String),
    nz(row.due_date),
    columnDropped("tasks", "end_date") ? null : nz(row.end_date),
    columnDropped("tasks", "deadline") ? null : nz(row.deadline),
    Boolean(row.all_day),
    nz(row.start_time),
    nz(row.end_time),
    canonicalRecurrence(row.recurrence),
    columnDropped("tasks", "estimate_minutes")
      ? null
      : ((row.estimate_minutes as number) ?? null),
    nz(row.snoozed_until),
    nzInstant(row.completed_at),
    Boolean(row.is_deleted),
  ]);
}
