import { create } from "zustand";

/**
 * Which tasks the next action applies to.
 *
 * Deliberately not part of the document: a selection is a thing the user is
 * holding right now, not a fact about their tasks. It does not survive a
 * restart, it never syncs, and it never reaches the disk.
 *
 * Selecting is invisible until it is used. There is no permanent checkbox
 * column — a Ctrl/Cmd-click, a Shift-click or the "Select" button turns the
 * mode on, and clearing it puts the lists back exactly as they were. That is
 * the whole reason `active` exists separately from `ids`: the mode can be on
 * with nothing picked yet, which is what the button does.
 */
interface SelectionState {
  /** In pick order, so a bulk action can report "the first one" honestly. */
  ids: string[];
  /**
   * Where a Shift-click measures from — the last row picked with a plain
   * click. Without it a range has no direction and Shift means "toggle".
   */
  anchorId: string | null;
  /** Rows show their checkbox. True whenever anything is picked, too. */
  active: boolean;

  /** Turn the mode on with nothing picked. */
  begin(): void;
  /**
   * Pick or unpick one row.
   *
   * `listIds` is the list the row was clicked in, in the order it is drawn:
   * a Shift-click extends across *that* list, and a range that spans two
   * different lists is not a range the user can see.
   */
  pick(taskId: string, options?: { listIds?: string[]; range?: boolean }): void;
  clear(): void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  ids: [],
  anchorId: null,
  active: false,

  begin: () => set({ active: true }),

  pick: (taskId, options = {}) => {
    const { ids, anchorId } = get();
    const listIds = options.listIds ?? [];

    if (options.range && anchorId && anchorId !== taskId) {
      const from = listIds.indexOf(anchorId);
      const to = listIds.indexOf(taskId);
      if (from !== -1 && to !== -1) {
        const span = listIds.slice(Math.min(from, to), Math.max(from, to) + 1);
        // A union rather than a replacement: a range is something the user is
        // adding to what they already picked, not a fresh start.
        const merged = [...ids];
        for (const id of span) if (!merged.includes(id)) merged.push(id);
        // The anchor stays put, so dragging the Shift-click further extends
        // the same range instead of ratcheting it one row at a time.
        set({ ids: merged, active: true });
        return;
      }
    }

    const next = ids.includes(taskId)
      ? ids.filter((id) => id !== taskId)
      : [...ids, taskId];

    set({
      ids: next,
      anchorId: taskId,
      // Unpicking the last row leaves the mode on: the checkboxes staying put
      // is what lets someone correct a misclick without starting over.
      active: true,
    });
  },

  clear: () => set({ ids: [], anchorId: null, active: false }),
}));
