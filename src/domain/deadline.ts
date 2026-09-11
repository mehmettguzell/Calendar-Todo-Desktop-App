import type { Instant, LocalDate } from "./types";

/**
 * A dated checkpoint on the way to finishing a task.
 *
 * `Task.deadline` is the day the whole thing stops being on time — one date,
 * one answer. A project reaches that day through several of its own: "design
 * finished by 5 September, backend by the 25th, store submission by 15
 * October". Those are not the day the project is due, and they are not steps
 * either: a step is work somebody does, a deadline is a date work has to be
 * done by. The same step can move between deadlines, and a deadline can pass
 * with no step of its own attached to it.
 *
 * So they are records in their own right rather than a field on the task or a
 * date borrowed from a subtask. A row apiece is also what lets two devices
 * tick two different deadlines of one plan without either losing the other:
 * merged whole, a list would keep only the last write.
 */
export interface Deadline {
  id: string;
  /** The task this is a checkpoint of. */
  taskId: string;
  /** What has to be true by `date` — "Backend bitecek". */
  label: string;
  date: LocalDate;
  /**
   * When it was ticked off, `null` while it is still outstanding.
   *
   * A date that has passed is not the same fact as a date that was missed, and
   * a checklist that cannot record the difference turns permanently red — at
   * which point it stops being read.
   */
  completedAt: Instant | null;
  /** Tie-breaker for two checkpoints landing on the same day. */
  order: number;
  createdAt: Instant;
  updatedAt: Instant;
  /** Soft delete — history is never destroyed. */
  deletedAt: Instant | null;
}

/** What the user typed, trimmed, or `null` when they typed nothing usable. */
export function normaliseLabel(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, MAX_LABEL_LENGTH) : null;
}

/**
 * A ceiling on the label.
 *
 * Long enough for a sentence naming what finishes, short enough that one
 * pasted paragraph cannot push every date off the side of a plan card.
 */
export const MAX_LABEL_LENGTH = 120;

/**
 * Chronological, because that is the only order a set of dates has.
 *
 * Completed ones stay in place rather than sinking: unlike a step, a checkpoint
 * that has been met is still part of the story the dates tell — "we hit the
 * first two and missed the third" is unreadable once the list stops being a
 * timeline.
 */
export function sortDeadlines(list: Deadline[]): Deadline[] {
  return [...list].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.order - b.order ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** Outstanding, and its day has gone. */
export function isMissed(deadline: Deadline, today: LocalDate): boolean {
  return deadline.completedAt === null && deadline.date < today;
}

/**
 * The next checkpoint still to be met, or `null` when none is left.
 *
 * A missed one still counts as next: it is the thing most in need of
 * attention, and quietly skipping to the one after it is how a date gets
 * forgotten.
 */
export function nextDeadline(list: Deadline[]): Deadline | null {
  return sortDeadlines(list).find((d) => d.completedAt === null) ?? null;
}

/** How many are met, out of how many there are. */
export function deadlineProgress(list: Deadline[]): {
  met: number;
  total: number;
} {
  return {
    met: list.filter((d) => d.completedAt !== null).length,
    total: list.length,
  };
}
