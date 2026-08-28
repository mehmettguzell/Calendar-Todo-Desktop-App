import type { Task } from "./types";

/**
 * Manual placement, laid over an automatic sort.
 *
 * These lists sort themselves — by priority, by time of day — and that is what
 * a user wants right up until the one morning it is not. So a drag does not
 * flip a list into "manual mode" and abandon priority: it pins the single row
 * that was dragged to the slot it was dropped on. Every untouched row keeps
 * flowing by the normal sort, filling the gaps around the pins.
 *
 * The consequence worth knowing: a pin is a slot, not a neighbour. A row pinned
 * to slot 2 stays second even after the rows around it change, and it lets go
 * only when the user drags it again or clears the arrangement.
 */

/** The slot a task was pinned to, or `null` when it has never been dragged. */
export function pinOf(task: Task): number | null {
  return typeof task.manualOrder === "number" ? task.manualOrder : null;
}

export function hasPins(tasks: Task[]): boolean {
  return tasks.some((task) => pinOf(task) !== null);
}

/**
 * Lay `items` out with pinned rows nailed to their slots.
 *
 * `items` must already be in the list's automatic order — that order is exactly
 * what the unpinned rows keep. Two rows cannot both hold one slot, so a
 * collision sends the later pin to the nearest free slot; nothing is dropped
 * and the result is always a permutation of the input.
 */
export function arrangePinned<T>(
  items: T[],
  pin: (item: T) => number | null,
): T[] {
  const pinned: { item: T; slot: number }[] = [];
  const floating: T[] = [];
  for (const item of items) {
    const slot = pin(item);
    if (slot === null) floating.push(item);
    else pinned.push({ item, slot });
  }
  if (pinned.length === 0) return items;

  // Lowest pin first: the row the user asked to be first gets first refusal on
  // slot 0, rather than losing it to whoever happened to be arranged earlier.
  pinned.sort((a, b) => a.slot - b.slot);

  const out: (T | null)[] = Array.from({ length: items.length }, () => null);
  for (const { item, slot } of pinned) out[freeSlotNear(out, slot)] = item;

  let next = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = floating[next++] ?? null;
  }
  return out.filter((item): item is T => item !== null);
}

/** The first free slot at or after `wanted`, searching backwards at the end. */
function freeSlotNear<T>(out: (T | null)[], wanted: number): number {
  const start = Math.min(Math.max(wanted, 0), out.length - 1);
  for (let i = start; i < out.length; i++) if (out[i] === null) return i;
  for (let i = start - 1; i >= 0; i--) if (out[i] === null) return i;
  return out.length - 1; // unreachable: pins never outnumber slots
}

/** Move one item inside a list, returning a new list. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.min(Math.max(to, 0), items.length - 1);
  if (from === target) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1) as [T];
  next.splice(target, 0, moved);
  return next;
}

/**
 * Insert `id` into a list at `slot` — a card arriving from another column.
 *
 * Dropping past the last row means "put it at the end", which is one slot
 * further than any existing index, so the caller may legitimately pass
 * `list.length`.
 */
export function insertAt(ids: string[], id: string, slot: number): string[] {
  const without = ids.filter((each) => each !== id);
  const target = Math.min(Math.max(slot, 0), without.length);
  return [...without.slice(0, target), id, ...without.slice(target)];
}
