import type { HistoryEntry, Instant } from "./types";

/**
 * How hard a task is pushing back.
 *
 * Every postponement is already written down and never rewritten (spec §5:
 * "the system must preserve task history"), so the app is sitting on the one
 * signal a to-do list normally throws away: which tasks keep getting moved
 * without ever being started. A task snoozed once is a busy afternoon. A task
 * snoozed five times with no progress in between is not a scheduling problem —
 * it is a task that was written down wrong, usually because it is too big to
 * start or too vague to know what starting means.
 *
 * This reads that signal off history alone. It stores nothing, decides nothing,
 * and stays silent until the pattern is unambiguous.
 */
export type ResistanceLevel = "none" | "noticed" | "stuck";

export interface Resistance {
  /**
   * Snoozes since the last sign of real progress.
   *
   * Always the true count, including the ones below the speaking threshold —
   * `level` is what decides whether anything is said, and a caller that wants
   * the raw number (a weekly review, an export) should not be handed a zero.
   */
  postponements: number;
  /** The oldest postponement in the run: how long this has been going on. */
  since: Instant | null;
  level: ResistanceLevel;
}

/**
 * A pattern, not a coincidence.
 *
 * Two postponements is an ordinary week — a meeting ran long, then it rained.
 * Three in a row with nothing in between is the first point where the task
 * itself is the more likely explanation than the calendar, so that is where
 * the app is allowed to say something. Five is where the honest reading is
 * that it will not happen in its current shape.
 */
const NOTICED_AT = 3;
const STUCK_AT = 5;

const NO_RESISTANCE: Resistance = { postponements: 0, since: null, level: "none" };

/**
 * Anything that means the task actually moved. Reaching one of these ends the
 * run: a task that was worked on last Thursday and snoozed twice since is on
 * two, not on however many times it was ever postponed in its life.
 */
function isProgress(entry: HistoryEntry): boolean {
  if (entry.kind === "FOCUS_LOGGED") return true;
  if (entry.kind === "CREATED") return true;
  if (entry.kind === "RESTORED") return true;
  return (
    entry.kind === "STATUS_CHANGED" &&
    (entry.to === "IN_PROGRESS" || entry.to === "COMPLETED")
  );
}

/**
 * Read the current run of postponements off a task's history.
 *
 * Only `SNOOZED` counts. Spec §8 draws the line deliberately: a snooze is "not
 * now" about a task that was due, while a reschedule is a plan changing, and
 * plans move earlier as often as later. Counting reschedules would flag anyone
 * who reorganises their week, which is the opposite of the point. The paired
 * `RESCHEDULED` entry a day-jumping snooze also writes is ignored for the same
 * reason — it is the same single act of postponement, recorded twice.
 *
 * `entries` may be in any order; the newest is found rather than assumed.
 */
export function taskResistance(entries: HistoryEntry[]): Resistance {
  if (entries.length === 0) return NO_RESISTANCE;

  const newestFirst = [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  let postponements = 0;
  let since: Instant | null = null;

  for (const entry of newestFirst) {
    if (isProgress(entry)) break;
    if (entry.kind !== "SNOOZED") continue;
    postponements += 1;
    since = entry.at;
  }

  return {
    postponements,
    since,
    level:
      postponements >= STUCK_AT
        ? "stuck"
        : postponements >= NOTICED_AT
          ? "noticed"
          : "none",
  };
}
