import type { LocalDate } from "@/domain/types";
import { useClipboardStore } from "./clipboardStore";
import { useStore } from "./store";

/**
 * Land whatever is on the clipboard on `date`.
 *
 * Copy and cut differ only here: a copy creates a new task, a cut moves the one
 * that was already there. Both then look identical to every view, because both
 * end as ordinary store mutations with ordinary history entries.
 *
 * `time` is `undefined` when the drop had no opinion about the clock — a month
 * cell — and a string or `null` when it did.
 */
export function pasteTaskOn(
  date: LocalDate,
  time?: string | null,
): "copied" | "moved" | null {
  const clipboard = useClipboardStore.getState();
  const clip = clipboard.clip;
  if (!clip) return null;

  const store = useStore.getState();
  const source = store.db.tasks.find(
    (t) => t.id === clip.taskId && t.deletedAt === null,
  );
  // The task was deleted between the copy and the paste. Drop the clip rather
  // than leaving a menu entry that does nothing when clicked.
  if (!source) {
    clipboard.clear();
    return null;
  }

  if (clip.mode === "cut") {
    store.reschedule(clip.taskId, date, time);
    // A cut moves a task once. Leaving it on the clipboard would turn the
    // second paste into a silent copy of something the user thinks they moved.
    clipboard.clear();
    return "moved";
  }

  store.duplicateTask(clip.taskId, {
    dueDate: date,
    ...(time === undefined ? {} : { startTime: time }),
  });
  return "copied";
}
