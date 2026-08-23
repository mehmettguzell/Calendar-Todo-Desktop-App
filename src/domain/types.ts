/**
 * Domain vocabulary for Tempo.
 *
 * There is exactly ONE actionable record type: `Task`. Calendar, Todo, Today
 * and Search are read-side projections of the same rows — never copies.
 *
 * Two statuses in the spec (OVERDUE, SNOOZED) are *situational*: they are a
 * function of the clock, not of user intent. Persisting them would go stale the
 * moment the app is closed, so only intentional states are stored
 * (`StoredStatus`) and the full `TaskStatus` is derived on read.
 */

/** `YYYY-MM-DD` in the user's local calendar. */
export type LocalDate = string;
/** `HH:mm` in the user's local clock. */
export type LocalTime = string;
/** ISO-8601 instant, always serialised in UTC. */
export type Instant = string;

/** Statuses a user can deliberately put a task into. */
export type StoredStatus = "TODO" | "IN_PROGRESS" | "COMPLETED";

/** Every status the UI can show, including the two derived ones. */
export type TaskStatus = StoredStatus | "SNOOZED" | "OVERDUE";

export const PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Repeat every `interval` units of `freq`. Always >= 1. */
  interval: number;
  /** WEEKLY only. 0 = Sunday … 6 = Saturday. Empty/undefined = anchor weekday. */
  byWeekday?: number[];
  /** Inclusive last date the series may produce. */
  until?: LocalDate | null;
  /** Maximum number of occurrences produced, counting the anchor. */
  count?: number | null;
}

/**
 * The single source of truth. A subtask is a Task with `parentId` set; a
 * calendar entry is a Task with a `dueDate`; a todo item is any Task at all.
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  /** Intent only — use `effectiveStatus()` for what to render. */
  status: StoredStatus;
  priority: Priority;
  /** `null` means unscheduled: visible in Todo, absent from the calendar. */
  dueDate: LocalDate | null;
  /** Optional multi-day or deadline end date (`YYYY-MM-DD`). */
  endDate?: LocalDate | null;
  allDay: boolean;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  categoryId: string | null;
  tags: string[];
  parentId: string | null;
  /** When set, `dueDate` is the series anchor rather than a single date. */
  recurrence: Recurrence | null;
  /** Suppresses the task from active lists/reminders until this instant. */
  snoozedUntil: Instant | null;
  /**
   * How long the user thinks this will take, in minutes.
   *
   * Paired with the focus timer, this is what turns time tracking into
   * something useful: a record of how wrong the last twenty estimates were is
   * the only thing that ever makes the next one better.
   */
  estimateMinutes?: number | null;
  /** Manual sort position within a day / list. */
  order: number;
  createdAt: Instant;
  updatedAt: Instant;
  completedAt: Instant | null;
  /** Soft delete — history is never destroyed. */
  deletedAt: Instant | null;
}

/**
 * Per-occurrence state for a recurring series.
 *
 * Only *situational* state is stored here (done / snoozed). Editing content or
 * dates always edits the series, which keeps one logical task = one record.
 */
export interface Occurrence {
  /** `${taskId}::${date}` */
  id: string;
  taskId: string;
  date: LocalDate;
  status: StoredStatus;
  completedAt: Instant | null;
  snoozedUntil: Instant | null;
  /** Conflict tie-breaker when two devices touch the same occurrence. */
  updatedAt: Instant;
}

export type ReminderKind = "RELATIVE" | "ABSOLUTE";
export type ReminderStatus = "PENDING" | "FIRED" | "DISMISSED";

export interface Reminder {
  id: string;
  taskId: string;
  kind: ReminderKind;
  /** RELATIVE: minutes *before* the task starts (0 = exactly at start). */
  offsetMinutes: number | null;
  /** ABSOLUTE: the fixed instant to fire at. */
  remindAt: Instant | null;
  status: ReminderStatus;
  /** Postpones this reminder without touching the task. */
  snoozedUntil: Instant | null;
  /** Recurring series: the last occurrence date this reminder already fired for. */
  lastFiredFor: LocalDate | null;
  createdAt: Instant;
  /** Conflict tie-breaker when two devices touch the same reminder. */
  updatedAt: Instant;
}

export type HistoryKind =
  | "CREATED"
  | "UPDATED"
  | "STATUS_CHANGED"
  | "RESCHEDULED"
  | "SNOOZED"
  | "REMINDER_ADDED"
  | "REMINDER_REMOVED"
  | "REMINDER_FIRED"
  | "FOCUS_LOGGED"
  | "DELETED"
  | "RESTORED";

/** Append-only. Entries are never rewritten or removed. */
export interface HistoryEntry {
  id: string;
  taskId: string;
  at: Instant;
  kind: HistoryKind;
  /** Set when the entry concerns one occurrence of a recurring series. */
  occurrenceDate: LocalDate | null;
  field: string | null;
  from: string | null;
  to: string | null;
  note: string | null;
}

export interface FocusSession {
  id: string;
  taskId: string;
  occurrenceDate: LocalDate | null;
  startedAt: Instant;
  endedAt: Instant | null;
  durationSec: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  language?: "tr" | "en";
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  /** ISO 4217 code the budget view formats amounts in. */
  currency?: string;
  /** Default RELATIVE reminder offset offered in the editor. */
  defaultReminderOffset: number;
  /** Visible hour range in week/day grids. */
  dayStartHour: number;
  dayEndHour: number;
  /** Time given to an all-day task when a snooze needs a clock time. */
  allDayReminderTime: LocalTime;
}

/**
 * A Task resolved against one calendar date — what every view actually renders.
 *
 * For a non-recurring task there is exactly one instance and its state lives on
 * the task. For a recurring series there is one instance per occurrence date and
 * its state lives on the matching `Occurrence`.
 */
export interface TaskInstance {
  /** Stable React key and mutation target: `taskId` or `taskId::date`. */
  key: string;
  task: Task;
  /** Occurrence date, or `null` for an unscheduled task. */
  date: LocalDate | null;
  isRecurring: boolean;
  occurrence: Occurrence | null;
  storedStatus: StoredStatus;
  /** Includes the derived OVERDUE / SNOOZED states. */
  status: TaskStatus;
  completedAt: Instant | null;
  snoozedUntil: Instant | null;
  /** Resolved local datetimes, `null` for all-day or unscheduled tasks. */
  startsAt: Date | null;
  endsAt: Date | null;
  /**
   * Where this date sits inside a multi-day task (`dueDate`..`endDate`).
   *
   * A one-day task is `{ length: 1, index: 0 }`, so views can treat every
   * instance the same and only branch on `length > 1` when they want to draw a
   * continuation bar.
   */
  span: TaskSpan;
}

/** Position of one rendered date within a task's `dueDate`..`endDate` range. */
export interface TaskSpan {
  /** Total number of days the task covers. Always >= 1. */
  length: number;
  /** 0-based offset of this instance's date inside the range. */
  index: number;
  isStart: boolean;
  isEnd: boolean;
}

/**
 * A record of something that was hard-deleted.
 *
 * A soft delete travels as an ordinary field change, but a *purge* removes the
 * row entirely — and a row that is simply absent is indistinguishable from one
 * this device has never seen, so the next sync would download it straight back.
 * The tombstone is what makes "gone" a fact rather than an absence.
 */
export interface Tombstone {
  kind: "task" | "category" | "reminder" | "occurrence" | "transaction";
  id: string;
  at: Instant;
}

/** Identifies the mutation target: a task, optionally one of its occurrences. */
export interface InstanceRef {
  taskId: string;
  occurrenceDate: LocalDate | null;
}
