import { useMemo, useState } from "react";
import { toLocalDate } from "@/domain/datetime";
import { occurrenceId } from "@/domain/ids";
import { toInstance } from "@/domain/task";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { EMPTY_FILTERS, useOccurrenceIndex, type Filters } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { usePresence } from "@/ui/hooks";
import type { ViewId } from "@/ui/Sidebar";
import type { CalendarMode } from "@/ui/views/CalendarView";
import type { QuickAddSeed } from "./AppOverlays";

/** How long the detail panel is held on screen after it is deselected. */
const PANEL_EXIT_MS = 260;

export interface Selection {
  taskId: string;
  occurrenceDate: LocalDate | null;
}

/**
 * Which page, which day, which task — the shell's own state, in one place.
 *
 * All of it lives above the views on purpose. `panelMaximized` is here so Escape
 * can back out of full screen before it closes the panel, and so the next task
 * opens docked; `daySelection` is here because Ctrl+V needs an unambiguous
 * target and the only honest one is the day the user last pointed at.
 */
export function useShellState() {
  const [view, setView] = useState<ViewId>("today");
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<LocalDate>(() => toLocalDate(new Date()));
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const [daySelection, setDaySelection] = useState<LocalDate | null>(null);

  return {
    view,
    setView,
    mode,
    setMode,
    anchor,
    setAnchor,
    filters,
    setFilters,
    selection,
    setSelection,
    panelMaximized,
    setPanelMaximized,
    daySelection,
    setDaySelection,
  };
}

/** Every overlay's open/closed flag. None of them affect the page beneath. */
export function useOverlayState() {
  const [quickAdd, setQuickAdd] = useState<QuickAddSeed | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [dayPromptOpen, setDayPromptOpen] = useState(false);
  /**
   * The checkpoint being edited, when a deadline chip was the thing clicked.
   *
   * A deadline marker is not the task it belongs to: opening the task panel on it
   * would offer a title, a schedule and a status that all belong to the plan, and
   * neither of the two fields the marker actually has.
   */
  const [editingDeadline, setEditingDeadline] = useState<{
    taskId: string;
    deadlineId: string;
  } | null>(null);

  return {
    quickAdd,
    setQuickAdd,
    settingsOpen,
    setSettingsOpen,
    paletteOpen,
    setPaletteOpen,
    spendOpen,
    setSpendOpen,
    dayPromptOpen,
    setDayPromptOpen,
    editingDeadline,
    setEditingDeadline,
  };
}

/**
 * The selected task, re-derived from the live store on every render.
 *
 * An edit made anywhere — a calendar click, a todo checkbox, a fired reminder —
 * shows up here immediately; holding a snapshot would break that. The panel then
 * outlives the selection by one animation, so the column starts collapsing the
 * moment the task is deselected and the held panel rides it off the right edge.
 */
export function useSelectedInstance(selection: Selection | null) {
  const tasks = useStore((s) => s.db.tasks);
  const occurrences = useOccurrenceIndex();
  const now = useNow();

  const selected: TaskInstance | null = useMemo(() => {
    if (!selection) return null;
    const task = tasks.find((t) => t.id === selection.taskId);
    if (!task || task.deletedAt) return null;
    const date = selection.occurrenceDate ?? task.dueDate;
    const occurrence = date
      ? (occurrences.get(occurrenceId(task.id, date)) ?? null)
      : null;
    return toInstance(task, date, occurrence, now);
  }, [selection, tasks, occurrences, now]);

  return { selected, panel: usePresence(selected, PANEL_EXIT_MS) };
}
