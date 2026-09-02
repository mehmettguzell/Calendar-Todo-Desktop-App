import { nowInstant } from "./datetime";
import { createId } from "./ids";
import type { HistoryEntry, HistoryKind, InstanceRef, LocalDate } from "./types";

interface HistoryInput {
  taskId: string;
  kind: HistoryKind;
  occurrenceDate?: LocalDate | null;
  field?: string | null;
  from?: string | null;
  to?: string | null;
  note?: string | null;
}

/** History is append-only — nothing here ever mutates an existing entry. */
export function historyEntry(input: HistoryInput): HistoryEntry {
  return {
    id: createId("h"),
    taskId: input.taskId,
    at: nowInstant(),
    kind: input.kind,
    occurrenceDate: input.occurrenceDate ?? null,
    field: input.field ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
    note: input.note ?? null,
  };
}

export function refEntry(ref: InstanceRef, kind: HistoryKind, rest: Omit<HistoryInput, "taskId" | "kind" | "occurrenceDate"> = {}): HistoryEntry {
  return historyEntry({
    taskId: ref.taskId,
    kind,
    occurrenceDate: ref.occurrenceDate,
    ...rest,
  });
}

const KIND_LABEL: Record<HistoryKind, string> = {
  CREATED: "Created",
  UPDATED: "Updated",
  STATUS_CHANGED: "Status changed",
  RESCHEDULED: "Rescheduled",
  SNOOZED: "Snoozed",
  REMINDER_ADDED: "Reminder added",
  REMINDER_REMOVED: "Reminder removed",
  REMINDER_FIRED: "Reminder fired",
  DEADLINE_ADDED: "Deadline added",
  DEADLINE_REMOVED: "Deadline removed",
  DEADLINE_MET: "Deadline met",
  FOCUS_LOGGED: "Focus session",
  DELETED: "Moved to trash",
  RESTORED: "Restored",
};

export function describeHistory(entry: HistoryEntry): string {
  if (entry.note) return entry.note;
  const label = KIND_LABEL[entry.kind];
  if (entry.field && entry.from !== null && entry.to !== null) {
    return `${label}: ${entry.field} ${entry.from} → ${entry.to}`;
  }
  if (entry.field && entry.to !== null) return `${label}: ${entry.field} → ${entry.to}`;
  return label;
}

export function historyKindLabel(kind: HistoryKind): string {
  return KIND_LABEL[kind];
}
