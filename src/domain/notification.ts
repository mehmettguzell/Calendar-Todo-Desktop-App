import { describeWhen, durationMinutes, formatTracked } from "./datetime";
import { spanEnd } from "./task";
import type { Category, TaskInstance } from "./types";

/**
 * What an OS banner actually says.
 *
 * Kept pure and separate from the delivery mechanism for two reasons: the
 * wording is the part that has to be right and is therefore the part worth
 * testing, and the same payload feeds both the desktop toast and the in-app
 * card, so the two can never describe the same reminder differently.
 */
export interface NotificationPayload {
  title: string;
  body: string;
}

/**
 * A reminder's banner text.
 *
 * The spec's example is
 *
 *     Project presentation
 *     Today at 14:00
 *
 * so the title is the task and the body leads with when. Everything after that
 * — how late it is, how long it runs, which category it belongs to — is added
 * only when it tells the reader something they cannot already see, because a
 * banner is read in about a second and a crowded one is read as noise.
 */
export function reminderNotification(
  instance: TaskInstance,
  now: Date,
  category?: Category | null,
): NotificationPayload {
  const { task } = instance;
  const timed = !task.allDay && task.startTime !== null;
  const parts: string[] = [
    describeWhen(instance.date, timed ? task.startTime : null, now),
  ];

  if (instance.status === "OVERDUE") {
    parts.unshift("Overdue");
  }

  const end = spanEnd(task);
  if (end) {
    parts.push(`until ${end}`);
  } else if (timed && task.endTime && task.startTime) {
    const minutes = durationMinutes(task.startTime, task.endTime);
    if (minutes > 0) parts.push(formatTracked(minutes * 60));
  }

  if (category) parts.push(category.name);
  if (task.priority === "HIGH") parts.push("High priority");

  return {
    title: task.title.trim() || "Untitled task",
    body: parts.join(" · "),
  };
}
