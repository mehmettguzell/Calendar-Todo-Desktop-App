import {
  addDaysLocal,
  daysBetween,
  minutesFromMidnight,
  minutesToTime,
  nowInstant,
} from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { occurrenceId } from "@/domain/ids";
import { enclosingPlan } from "@/domain/task";
import { syncTaskToCloud } from "@/sync/storeBridge";
import type { Database } from "@/data/db";
import type {
  HistoryEntry,
  InstanceRef,
  Instant,
  LocalDate,
  Occurrence,
  StoredStatus,
  Task,
  TaskInstance,
} from "@/domain/types";

// Mutations more than one store action needs. Each one takes a `Database` and
// returns the next one, so nothing here reaches for the store itself.

/** Where a mutation lands: the task row, or one occurrence of a series. */
export function refOf(instance: TaskInstance): InstanceRef {
  return {
    taskId: instance.task.id,
    occurrenceDate: instance.isRecurring ? instance.date : null,
  };
}

/**
 * Write a status to the right place: the task itself, or the occurrence row of
 * a recurring series. Callers never need to know which, which is the whole
 * point of `InstanceRef`.
 */
export function applyStatus(
  db: Database,
  ref: InstanceRef,
  status: StoredStatus,
): Database {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return db;

  const at = nowInstant();
  const completedAt = status === "COMPLETED" ? at : null;
  const entry = historyEntry({
    taskId: ref.taskId,
    kind: "STATUS_CHANGED",
    occurrenceDate: ref.occurrenceDate,
    field: "status",
    from: currentStoredStatus(db, ref),
    to: status,
  });

  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    const existing = db.occurrences.find((o) => o.id === id);
    const occurrence: Occurrence = {
      id,
      taskId: task.id,
      date: ref.occurrenceDate,
      status,
      completedAt,
      snoozedUntil:
        status === "COMPLETED" ? null : (existing?.snoozedUntil ?? null),
      updatedAt: at,
    };
    // A habit's first tick starts the plan it hangs off, exactly as a one-off
    // step's does — the completion lives on the occurrence, but the plan it
    // belongs to is no less under way.
    const startedByHabit =
      status === "COMPLETED"
        ? planStartedBy(db, task.id, at)
        : { tasks: db.tasks, entries: [] };
    return {
      ...db,
      tasks: startedByHabit.tasks,
      occurrences: existing
        ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
        : [...db.occurrences, occurrence],
      history: [...db.history, entry, ...startedByHabit.entries],
    };
  }

  const next: Task = {
    ...task,
    status,
    completedAt,
    snoozedUntil: status === "COMPLETED" ? null : task.snoozedUntil,
    updatedAt: at,
  };

  // Finishing a task finishes what it was made of. A parent marked COMPLETED
  // over subtasks that still read TODO is not a record of anything — the two
  // halves of one task disagreeing about whether it happened — and the leftover
  // children would go on surfacing in Today and in the reminder queue.
  //
  // Reopening is deliberately *not* symmetric: a subtask that was genuinely
  // done stays done when its parent turns out to need more work.
  const cascade = status === "COMPLETED" ? openDescendants(db, task.id) : [];

  const started =
    status === "COMPLETED"
      ? planStartedBy(db, task.id, at)
      : { tasks: db.tasks, entries: [] };

  return {
    ...db,
    tasks: started.tasks.map((t) => {
      if (t.id === task.id) return next;
      return cascade.includes(t.id)
        ? { ...t, status, completedAt, snoozedUntil: null, updatedAt: at }
        : t;
    }),
    history: [
      ...db.history,
      entry,
      ...started.entries,
      ...cascade.map((id) =>
        historyEntry({
          taskId: id,
          kind: "STATUS_CHANGED",
          field: "status",
          from: db.tasks.find((t) => t.id === id)?.status ?? "TODO",
          to: status,
          note: `Completed with "${task.title}"`,
        }),
      ),
    ],
  };
}

/**
 * Ticking anything inside a plan starts that plan.
 *
 * "Başlayacaklarım" is only worth a tab if it is true, and a plan with three
 * ticked steps sitting in it is not. The alternative — deriving "started" from
 * the steps when the list is drawn — reads the same on screen and behaves
 * worse: someone who sets a plan back to not-started would watch it snap
 * straight back, because the derivation would still be looking at the same
 * ticked step. So the promotion happens once, here, as a real status change
 * with its own history entry, and the button that sets it stays authoritative
 * afterwards.
 *
 * Only `TODO` is promoted. A plan already `IN_PROGRESS` has nothing to learn
 * from this, and a `COMPLETED` one must not be quietly reopened by a step
 * being ticked underneath it.
 */
export function planStartedBy(
  db: Database,
  taskId: string,
  at: Instant,
): { tasks: Task[]; entries: HistoryEntry[] } {
  const task = db.tasks.find((t) => t.id === taskId);
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const plan = task ? enclosingPlan(task, byId) : null;
  if (!plan || plan.status !== "TODO") {
    return { tasks: db.tasks, entries: [] };
  }
  return {
    tasks: db.tasks.map((t) =>
      t.id === plan.id ? { ...t, status: "IN_PROGRESS", updatedAt: at } : t,
    ),
    entries: [
      historyEntry({
        taskId: plan.id,
        kind: "STATUS_CHANGED",
        field: "status",
        from: "TODO",
        to: "IN_PROGRESS",
        note: `Started with "${task?.title ?? ""}"`,
      }),
    ],
  };
}

/** Live, unfinished descendants of a task — what a completion cascades onto. */
export function openDescendants(db: Database, taskId: string): string[] {
  const ids = new Set(collectSubtree(db.tasks, taskId));
  ids.delete(taskId);
  return db.tasks
    .filter(
      (t) => ids.has(t.id) && t.deletedAt === null && t.status !== "COMPLETED",
    )
    .map((t) => t.id);
}

export function currentStoredStatus(db: Database, ref: InstanceRef): StoredStatus {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return "TODO";
  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    return db.occurrences.find((o) => o.id === id)?.status ?? "TODO";
  }
  return task.status;
}

export function writeSnoozeUntil(
  db: Database,
  ref: InstanceRef,
  until: string | null,
): Database {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return db;

  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    const existing = db.occurrences.find((o) => o.id === id);
    const at = nowInstant();
    const occurrence: Occurrence = existing
      ? { ...existing, snoozedUntil: until, updatedAt: at }
      : {
          id,
          taskId: task.id,
          date: ref.occurrenceDate,
          status: "TODO",
          completedAt: null,
          snoozedUntil: until,
          updatedAt: at,
        };
    return {
      ...db,
      occurrences: existing
        ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
        : [...db.occurrences, occurrence],
    };
  }
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === task.id
        ? { ...t, snoozedUntil: until, updatedAt: nowInstant() }
        : t,
    ),
  };
}

/** Keep a `dueDate`..`endDate` run the same length when its start moves. */
export function shiftedEnd(task: Task, dueDate: LocalDate | null): LocalDate | null {
  const end = task.endDate ?? null;
  if (!end || !task.dueDate || !dueDate) return dueDate ? end : null;
  if (end <= task.dueDate) return null;
  return addDaysLocal(dueDate, daysBetween(task.dueDate, end));
}

/** Keep a timed task the same length when its start moves. */
export function shiftedEndTime(task: Task, startTime: string | null): string | null {
  if (!task.endTime || !task.startTime || !startTime)
    return task.endTime ?? null;
  if (startTime === task.startTime) return task.endTime;
  const delta =
    minutesFromMidnight(startTime) - minutesFromMidnight(task.startTime);
  const end = minutesFromMidnight(task.endTime) + delta;
  if (end >= 24 * 60 - 1) return "23:59";
  if (end < 0) return "00:00";
  return minutesToTime(end);
}

/** Push a task and its descendants: one completion can touch the whole run. */
export function syncSubtree(db: Database, rootId: string): void {
  const ids = new Set(collectSubtree(db.tasks, rootId));
  for (const task of db.tasks) {
    if (ids.has(task.id)) void syncTaskToCloud(task);
  }
}

/** A task plus every descendant, so trash and restore act on a whole subtree. */
export function collectSubtree(tasks: Task[], rootId: string): string[] {
  const out = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = tasks
      .filter((t) => t.parentId !== null && frontier.includes(t.parentId))
      .map((t) => t.id);
    const fresh = children.filter((id) => !out.includes(id));
    out.push(...fresh);
    frontier = fresh;
  }
  return out;
}

export function describeSchedule(
  task: Pick<Task, "dueDate" | "endDate" | "allDay" | "startTime" | "endTime">,
): string {
  if (!task.dueDate) return "no date";
  const days =
    task.endDate && task.endDate > task.dueDate
      ? `${task.dueDate} → ${task.endDate}`
      : task.dueDate;
  if (task.allDay || !task.startTime) return `${days} (all-day)`;
  return task.endTime
    ? `${days} ${task.startTime}-${task.endTime}`
    : `${days} ${task.startTime}`;
}

export function serialise(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

