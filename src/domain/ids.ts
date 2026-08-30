import type { LocalDate } from "./types";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Time-sortable, collision-resistant id. No dependency needed. */
export function createId(prefix: string): string {
  const time = Date.now().toString(36).padStart(8, "0");
  let random = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) random += alphabet[byte % alphabet.length];
  return `${prefix}_${time}${random}`;
}

export function occurrenceId(taskId: string, date: LocalDate): string {
  return `${taskId}::${date}`;
}

/** Key used by every view; also the mutation target for status changes. */
export function instanceKey(taskId: string, date: LocalDate | null, recurring: boolean): string {
  return recurring && date ? occurrenceId(taskId, date) : taskId;
}

/**
 * React key for a task's deadline marker.
 *
 * A marker and the task's own scheduled day can both fall inside one rendered
 * range, so the marker needs a key of its own. It is never a mutation target:
 * completing a deadline marker completes the task, which `refOf` resolves from
 * `instance.task.id`, not from this.
 */
export function deadlineKey(taskId: string): string {
  return `${taskId}::deadline`;
}
