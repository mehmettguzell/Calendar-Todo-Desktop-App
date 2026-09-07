import type { MouseEvent } from "react";
import { useSelectionStore } from "@/state/selectionStore";

/**
 * "Is this one picked, and did that click mean to pick it?"
 *
 * One gesture, four shapes: a row in a list, a chip in the month grid, an
 * event in the week grid, a card on the note wall. They look nothing alike and
 * they all have to behave the same, because the bar that acts on the selection
 * is one bar and it does not care which of them the task came from.
 *
 * The rule everywhere: a plain click opens, unless the mode is already on or a
 * modifier is held — then it picks. That is what keeps a screen nobody is
 * selecting in looking exactly as it did before selecting existed.
 */
export function usePickGesture({
  taskId,
  listIds,
  enabled = true,
}: {
  taskId: string;
  /**
   * The things drawn beside this one, in order — what a Shift-click measures
   * across. Left out, Shift picks a single item: a range with no list to
   * measure in is not a range.
   */
  listIds?: string[];
  /** False where picking makes no sense, e.g. a deadline marker. */
  enabled?: boolean;
}) {
  const active = useSelectionStore((s) => s.active);
  const picked = useSelectionStore((s) => s.ids.includes(taskId));
  const pick = useSelectionStore((s) => s.pick);

  const picking = enabled && active;

  /** Returns true when it handled the click, so the caller stops there. */
  const onClickCapture = (event: MouseEvent): boolean => {
    if (!enabled) return false;
    if (!picking && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    pick(taskId, { listIds, range: event.shiftKey });
    return true;
  };

  /** For a real checkbox, where the click is the toggle rather than a guess. */
  const toggle = (range = false) => pick(taskId, { listIds, range });

  return { picking, picked, onClickCapture, toggle };
}
