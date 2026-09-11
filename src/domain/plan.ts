import type { Task } from "./types";

/**
 * Where a plan stands.
 *
 * A plan is a long-lived thing with a checklist under it, and the only
 * question anyone asks of a list of them is "which of these have I actually
 * started?". Three answers cover it, and they are ordered: nothing has begun,
 * something has, everything is done.
 *
 * The stage is **read off the plan's own status**, not guessed from its steps.
 * `IN_PROGRESS` is already in the spec (section 5) and already stored, so
 * starting a plan is an ordinary status change: it goes through `setStatus`,
 * writes the same history entry every other status change writes, and syncs as
 * one field on one row. Nothing new is persisted for this.
 *
 * The one thing steps decide is the end: a plan whose every step is ticked is
 * finished whether or not anyone came back to say so. The opposite inference —
 * "a step is done, so the plan must have started" — is deliberately *not* made
 * here, because it would fight the button: someone who sets a plan back to
 * not-started would watch it snap back. `applyStatus` handles that case where
 * it belongs, by really promoting the plan the moment a step is ticked.
 */
export type PlanStage = "NOT_STARTED" | "STARTED" | "COMPLETED";

export function planStage(plan: Task, steps: Task[]): PlanStage {
  if (isPlanComplete(plan, steps)) return "COMPLETED";
  return plan.status === "IN_PROGRESS" ? "STARTED" : "NOT_STARTED";
}

/**
 * Finished outright, or finished because every step is.
 *
 * The second half is what makes a checklist feel like it means something —
 * ticking the last box finishes the plan without a second, ceremonial click.
 * A plan with no steps at all cannot be finished this way: an empty list is
 * not a completed one.
 */
export function isPlanComplete(plan: Task, steps: Task[]): boolean {
  if (plan.status === "COMPLETED") return true;
  return steps.length > 0 && steps.every((s) => s.status === "COMPLETED");
}

/** Ticked steps out of all of them, and the percentage a bar should draw. */
export function planProgress(
  plan: Task,
  steps: Task[],
): { done: number; total: number; pct: number } {
  const done = steps.filter((s) => s.status === "COMPLETED").length;
  const total = steps.length;
  if (total > 0) {
    return { done, total, pct: Math.round((done / total) * 100) };
  }
  // No steps to measure, so the plan's own status is the whole story.
  return { done, total, pct: plan.status === "COMPLETED" ? 100 : 0 };
}
