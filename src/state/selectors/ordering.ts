import { arrangePinned, pinOf } from "@/domain/manualOrder";
import { priorityRank } from "./filters";
import {
  LocalDate,
  Task,
  TaskInstance,
} from "@/domain/types";

// How a day's instances are split, grouped and sorted for display.
/**
 * One day's rows, in the order Today prints them.
 *
 * Today draws three lists — the ones with a time on them, then the rest of the
 * day, then what has been finished — and Odaklanma drew the same day as one
 * flat list in whatever order the query happened to return. Two screens
 * showing one day in two orders is the same fault as two records for one task:
 * the second one has to be re-read to be trusted.
 *
 * So the arrangement lives here and both call it. `ordered` is the three lists
 * concatenated — the day as a single column, reading exactly as it reads on
 * Today.
 *
 * Deadlines are dropped: a date is not something you can spend an hour on, and
 * a marker in a list of things to work through is a row that cannot be
 * started. They reach Today through `deadlineMarkersOf` instead.
 */
export interface DayLists {
  timed: TaskInstance[];
  allDay: TaskInstance[];
  completed: TaskInstance[];
  /** timed → all-day → completed, as one list. */
  ordered: TaskInstance[];
  /** `ordered`'s task ids, which is what a Shift-click measures across. */
  ids: string[];
}

export function splitDay(instances: TaskInstance[]): DayLists {
  const sorted = arrangeInstances(
    instances.filter((instance) => !instance.deadlineOnly),
  );
  const open = sorted.filter((i) => i.storedStatus !== "COMPLETED");
  const timed = open.filter((i) => i.startsAt !== null);
  const allDay = open.filter((i) => i.startsAt === null);
  const completed = sorted.filter((i) => i.storedStatus === "COMPLETED");
  const ordered = [...timed, ...allDay, ...completed];
  return {
    timed,
    allDay,
    completed,
    ordered,
    ids: ordered.map((instance) => instance.task.id),
  };
}

export function groupByDate(
  instances: TaskInstance[],
): Map<LocalDate, TaskInstance[]> {
  const map = new Map<LocalDate, TaskInstance[]>();
  for (const instance of instances) {
    if (!instance.date) continue;
    const bucket = map.get(instance.date);
    if (bucket) bucket.push(instance);
    else map.set(instance.date, [instance]);
  }
  for (const bucket of map.values()) bucket.sort(compareInstances);
  return map;
}

/**
 * The day first; then all-day above timed, and timed by start.
 *
 * Most lists that come through here hold a single day, where the date test
 * decides nothing. The buckets that span one — "Bu hafta", "Daha sonra", and
 * the flat pill lists on Görevler — are the reason it is here: without it a
 * plan set for December sat above one set for next week whenever it happened
 * to be higher priority or older, and the heading said only that both were
 * later than this week. A list of dates that is not in date order makes the
 * reader check every row to find the next one.
 *
 * Undated rows sort last. They only meet dated ones in the pill lists, and
 * "no day" is the furthest-off day there is.
 */
export function compareInstances(a: TaskInstance, b: TaskInstance): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  const aTimed = a.startsAt !== null;
  const bTimed = b.startsAt !== null;
  if (aTimed !== bTimed) return aTimed ? 1 : -1;
  if (a.startsAt && b.startsAt) {
    const diff = a.startsAt.getTime() - b.startsAt.getTime();
    if (diff !== 0) return diff;
  }
  const priority =
    priorityRank(b.task.priority) - priorityRank(a.task.priority);
  if (priority !== 0) return priority;
  return (
    a.task.order - b.task.order || a.task.title.localeCompare(b.task.title)
  );
}

/**
 * Plan steps as they read on screen: what the user dragged, finished last.
 *
 * A plan is a list you work down, so a ticked step has stopped being part of
 * it — it is evidence that the plan is moving. Left where it was, it pushes
 * the next thing to do further down the card every time something gets done,
 * which is the opposite of what finishing something should do.
 *
 * Order inside each half is untouched, and nothing is written: a step that is
 * reopened climbs straight back to the place it was dragged to, because that
 * place was never given away.
 */
export function compareSteps(a: Task, b: Task): number {
  return (
    Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED") ||
    a.order - b.order
  );
}

export function arrangeSteps(steps: Task[]): Task[] {
  return [...steps].sort(compareSteps);
}

/**
 * A list exactly as it reads on screen: the automatic sort, then manual pins.
 *
 * Every list-shaped view goes through here, so a task dragged in Today sits
 * where it was dropped in Todo too — one task, one arrangement.
 */
export function arrangeInstances(instances: TaskInstance[]): TaskInstance[] {
  return arrangePinned([...instances].sort(compareInstances), (i) =>
    pinOf(i.task),
  );
}
