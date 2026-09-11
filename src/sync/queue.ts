// Ids waiting for the next batched write, one set per collection. Coalescing
// turns a bulk action's burst of mutations into a single request per table.

export const QUEUE_NAMES = [
  "tasks",
  "categories",
  "occurrences",
  "reminders",
  "transactions",
  "budgetCategories",
  "focus",
  "history",
  "deletedTasks",
  "deletedCategories",
  "deletedOccurrences",
  "deletedReminders",
  "deletedBudgetCategories",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export type QueueSnapshot = Record<QueueName, string[]>;

export const pendingIds = Object.fromEntries(
  QUEUE_NAMES.map((name) => [name, new Set<string>()]),
) as Record<QueueName, Set<string>>;

// The activity trail is append-only and nobody waits on it, so it rides along
// with the next flush instead of counting as work the user is waiting for.
const USER_QUEUES = QUEUE_NAMES.filter((name) => name !== "history");

export function pendingCount(): number {
  return USER_QUEUES.reduce((total, name) => total + pendingIds[name].size, 0);
}

export function clearAllQueues(): void {
  for (const name of QUEUE_NAMES) pendingIds[name].clear();
}

/** Empties every queue and hands back what it held, ready to be written. */
export function drainQueues(): QueueSnapshot {
  const snapshot = Object.fromEntries(
    QUEUE_NAMES.map((name) => [name, [...pendingIds[name]]]),
  ) as QueueSnapshot;
  clearAllQueues();
  return snapshot;
}

// Put a drained snapshot back after a failed write; ids queued in the meantime
// stay, because a set cannot hold the same id twice.
export function requeue(snapshot: QueueSnapshot): void {
  for (const name of QUEUE_NAMES) {
    for (const id of snapshot[name]) pendingIds[name].add(id);
  }
}
