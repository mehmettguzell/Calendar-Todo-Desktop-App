import { toLocalDate } from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { pasteTaskOn } from "@/state/clipboardActions";
import { useClipboardStore } from "@/state/clipboardStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUndoStore } from "@/state/undoStore";
import { useShortcuts } from "@/ui/hooks";
import type { ViewId } from "@/ui/Sidebar";
import type { QuickAddSeed } from "./AppOverlays";

export interface ShortcutContext {
  anchor: LocalDate;
  daySelection: LocalDate | null;
  selected: TaskInstance | null;
  panelMaximized: boolean;
  setAnchor: (date: LocalDate) => void;
  setView: (view: ViewId) => void;
  setQuickAdd: (seed: QuickAddSeed) => void;
  setPanelMaximized: (on: boolean) => void;
  setSelection: (selection: null) => void;
  togglePalette: () => void;
  focusComposer: () => boolean;
}

/**
 * Copying a task, when there is one to copy.
 *
 * A series is laid out by its rule, so cutting one occurrence would move every
 * other one too — those are offered as a copy instead.
 */
function clipboardActions(selected: TaskInstance | null) {
  return {
    onCopy: () => {
      if (!selected) return false;
      useClipboardStore
        .getState()
        .copy(selected.task.id, selected.task.title, selected.date);
      return true;
    },
    onCut: () => {
      if (!selected || selected.isRecurring) return false;
      useClipboardStore
        .getState()
        .cut(selected.task.id, selected.task.title, selected.date);
      return true;
    },
  };
}

/**
 * Escape backs out of one thing at a time, innermost first.
 *
 * A held selection is what the user is standing in, so it goes before the detail
 * panel behind it; full screen is a layer of its own, and shrinking back to the
 * column is what someone in it expects Escape to do, not losing the task.
 */
function backOut(context: ShortcutContext): void {
  if (useSelectionStore.getState().active) {
    useSelectionStore.getState().clear();
    return;
  }
  if (context.panelMaximized) {
    context.setPanelMaximized(false);
    return;
  }
  context.setSelection(null);
}

export function useAppShortcuts(context: ShortcutContext): void {
  useShortcuts({
    /*
     * Ctrl+N goes to the box that is already on screen.
     *
     * Three of the seven views carry a composer, and on those the modal is a
     * heavier answer to a question the page has already answered — it covers the
     * list you were looking at to ask for one line of text. Where there is no
     * composer (the calendar, the budget) the modal is still the way in, and
     * `focusComposer` says which case this is by whether it found one.
     */
    onNew: () => {
      if (!context.focusComposer()) {
        context.setQuickAdd({ date: context.anchor, time: null });
      }
    },
    onToday: () => {
      context.setAnchor(toLocalDate(new Date()));
      context.setView("today");
    },
    onEscape: () => backOut(context),
    onPalette: context.togglePalette,
    onUndo: () => useUndoStore.getState().undo(),
    ...clipboardActions(context.selected),
    onPaste: () => pasteTaskOn(context.daySelection ?? context.anchor) !== null,
  });
}
