import { useEffect, useMemo, useState } from "react";
import { toLocalDate } from "@/domain/datetime";
import { occurrenceId } from "@/domain/ids";
import { toInstance } from "@/domain/task";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { ensureNotificationPermission } from "@/services/notifications";
import {
  QUICK_CAPTURE_EVENT,
  QUICK_SPEND_EVENT,
  onDesktopEvent,
} from "@/services/desktop";
import { useSpendFeed } from "@/services/spendFeed";
import { notify } from "@/services/notifications";
import { spendNudgeDue } from "@/domain/spendLog";
import { useReminderScheduler } from "@/services/scheduler";
import {
  EMPTY_FILTERS,
  useOccurrenceIndex,
  type Filters,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { SettingsModal } from "@/ui/SettingsModal";
import { Sidebar, type ViewId } from "@/ui/Sidebar";
import { Topbar } from "@/ui/Topbar";
import { ReminderAlerts } from "@/ui/components/ReminderAlerts";
import { QuickAdd } from "@/ui/task/QuickAdd";
import { TaskPanel } from "@/ui/task/TaskPanel";
import { NotePanel } from "@/ui/task/NotePanel";
import {
  CalendarView,
  calendarTitle,
  stepAnchor,
  type CalendarMode,
} from "@/ui/views/CalendarView";
import { FocusView } from "@/ui/views/FocusView";
import { BudgetView } from "@/ui/views/BudgetView";
import { SpendCapture } from "@/ui/budget/SpendCapture";
import { DaySpendPrompt } from "@/ui/budget/DaySpendPrompt";
import { TasksView } from "@/ui/views/TasksView";
import { PlansView } from "@/ui/views/PlansView";
import { NotesView } from "@/ui/views/NotesView";
import { TodayView } from "@/ui/views/TodayView";
import { AuthModal } from "@/ui/components/AuthModal";
import { CommandPalette } from "@/ui/components/CommandPalette";
import { UndoToast } from "@/ui/components/UndoToast";
import { useUndoStore } from "@/state/undoStore";
import { pasteTaskOn } from "@/state/clipboardActions";
import { useClipboardStore } from "@/state/clipboardStore";
import { useAuthStore } from "@/state/authStore";
import { initSyncEngine } from "@/state/syncEngine";
import {
  useApplyLanguage,
  useApplyTheme,
  usePresence,
  useShortcuts,
} from "@/ui/hooks";
import { useI18n, type TranslationKey } from "@/lib/i18n";

/**
 * How long the detail panel stays mounted after the selection clears — long
 * enough to cover the slide in `shell.css` and the fade in `views.css`.
 */
const PANEL_EXIT_MS = 260;

/** The selected task, remembered as a reference rather than a snapshot. */
interface Selection {
  taskId: string;
  occurrenceDate: LocalDate | null;
}

interface QuickAddSeed {
  date: LocalDate | null;
  time: string | null;
}

/** Page heading per view, resolved through the dictionary like the nav is. */
const VIEW_TITLE_KEYS: Record<ViewId, TranslationKey> = {
  today: "navToday",
  calendar: "navCalendar",
  tasks: "navTasks",
  plans: "navPlans",
  notes: "navNotes",
  focus: "navFocus",
  budget: "navBudget",
};

export function App() {
  const ready = useStore((s) => s.ready);
  const hydrate = useStore((s) => s.hydrate);
  const tasks = useStore((s) => s.db.tasks);
  const settings = useStore((s) => s.db.settings);
  const occurrences = useOccurrenceIndex();
  const now = useNow();
  const { t, language } = useI18n();

  const [view, setView] = useState<ViewId>("today");
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<LocalDate>(() =>
    toLocalDate(new Date()),
  );
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddSeed | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [dayPromptOpen, setDayPromptOpen] = useState(false);
  /**
   * The calendar day a keyboard paste lands on.
   *
   * Ctrl+V has to have an unambiguous target, and the only honest one is the
   * day the user last pointed at — so clicking a cell marks it, and the mark is
   * visible rather than implied.
   */
  const [daySelection, setDaySelection] = useState<LocalDate | null>(null);

  const { alerts, dismissAlert } = useReminderScheduler();

  useEffect(() => {
    // Order matters: the local document is opened first, so the sync engine
    // never has to decide what to do with a store that is still empty — and an
    // account switch it triggers has something concrete to switch away from.
    void (async () => {
      await hydrate();
      initSyncEngine();
      await useAuthStore.getState().initAuth();
    })();
  }, [hydrate]);

  useEffect(() => {
    if (ready) void ensureNotificationPermission();
  }, [ready]);

  // `Ctrl+Shift+Space` from anywhere, and the tray menu, both land here. The
  // window has already been raised by the host by the time this fires.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onDesktopEvent(QUICK_CAPTURE_EVENT, () =>
      setQuickAdd({ date: toLocalDate(new Date()), time: null }),
    ).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // The tray's "Harcama ekle". A separate door from the task box on purpose:
  // the two are reached at different moments, and neither should cost a detour
  // through the other.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onDesktopEvent(QUICK_SPEND_EVENT, () => setSpendOpen(true)).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Poll the bank's notification mailbox while the app is open.
  useSpendFeed();

  /*
   * The evening prompt.
   *
   * Driven by `now`, which the scheduler already advances once a minute, so
   * this needs no clock of its own. The day is marked as soon as the prompt is
   * raised rather than when it is answered: a question asked and ignored has
   * still been asked, and asking it twice is how a nudge gets switched off.
   */
  useEffect(() => {
    if (!ready || dayPromptOpen) return;
    if (!spendNudgeDue(settings, new Date(now))) return;

    setDayPromptOpen(true);
    useStore.getState().markSpendNudged(toLocalDate(new Date(now)));
    void notify({
      title: t("spendNudgeNotifyTitle"),
      body: t("spendNudgeNotifyBody"),
    }).catch(() => undefined);
  }, [ready, now, settings, dayPromptOpen, t]);

  /**
   * The panel re-derives its instance from the live store on every render, so
   * an edit made anywhere (a calendar click, a todo checkbox, a fired reminder)
   * shows up here immediately. Holding a snapshot would break that.
   */
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

  /**
   * The panel outlives the selection by one animation. `has-panel` still
   * follows the live selection, so the column starts collapsing the moment the
   * task is deselected and the held panel rides it off the right edge.
   */
  const panel = usePresence(selected, PANEL_EXIT_MS);

  useApplyTheme(settings.theme);
  useApplyLanguage(language);
  useShortcuts({
    onNew: () => setQuickAdd({ date: anchor, time: null }),
    onToday: () => {
      setAnchor(toLocalDate(new Date()));
      setView("today");
    },
    onEscape: () => setSelection(null),
    onPalette: () => setPaletteOpen((open) => !open),
    onUndo: () => useUndoStore.getState().undo(),
    onCopy: () => {
      if (!selected) return false;
      useClipboardStore
        .getState()
        .copy(selected.task.id, selected.task.title, selected.date);
      return true;
    },
    onCut: () => {
      // A series is laid out by its rule: cutting one occurrence out of it
      // would move every other one too. Copy it instead.
      if (!selected || selected.isRecurring) return false;
      useClipboardStore
        .getState()
        .cut(selected.task.id, selected.task.title, selected.date);
      return true;
    },
    onPaste: () => pasteTaskOn(daySelection ?? anchor) !== null,
  });

  if (!ready) {
    return (
      <div className="loading">
        <span className="spinner" />
        Loading your tasks…
      </div>
    );
  }

  const openInstance = (instance: TaskInstance) =>
    setSelection({
      taskId: instance.task.id,
      occurrenceDate: instance.isRecurring ? instance.date : null,
    });

  const openTaskId = (
    taskId: string,
    occurrenceDate: LocalDate | null = null,
  ) => setSelection({ taskId, occurrenceDate });

  if (!ready) {
    return (
      <div className="loading">
        <span className="spinner" />
        Loading your tasks
      </div>
    );
  }

  const title =
    view === "calendar"
      ? calendarTitle(mode, anchor, settings.weekStartsOn)
      : t(VIEW_TITLE_KEYS[view]);

  return (
    <div className={selected ? "app has-panel" : "app"}>
      <Sidebar
        view={view}
        onView={setView}
        anchor={anchor}
        onAnchor={setAnchor}
        filters={filters}
        onFilters={setFilters}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        <Topbar
          view={view}
          title={title}
          mode={mode}
          onMode={setMode}
          onStep={(direction) => setAnchor(stepAnchor(mode, anchor, direction))}
          onToday={() => setAnchor(toLocalDate(new Date()))}
          filters={filters}
          onFilters={setFilters}
          onNewTask={() => setQuickAdd({ date: anchor, time: null })}
        />

        <div className="view-body scroll">
          {view === "today" ? (
            <TodayView
              filters={filters}
              selectedKey={selected?.key ?? null}
              onOpen={openInstance}
            />
          ) : null}

          {view === "calendar" ? (
            <CalendarView
              mode={mode}
              anchor={anchor}
              filters={filters}
              selectedDate={daySelection}
              onSelectDate={setDaySelection}
              onOpen={openInstance}
              onQuickAdd={(date, time) => setQuickAdd({ date, time })}
            />
          ) : null}

          {view === "tasks" ? (
            <TasksView
              filters={filters}
              selectedKey={selected?.key ?? null}
              onOpen={openInstance}
            />
          ) : null}

          {view === "plans" ? (
            <PlansView
              selectedKey={selected?.key ?? null}
              onOpen={openInstance}
            />
          ) : null}

          {view === "notes" ? (
            <NotesView
              selectedKey={selected?.key ?? null}
              onOpen={openInstance}
            />
          ) : null}

          {view === "focus" ? (
            <FocusView
              filters={filters}
              selectedKey={selected?.key ?? null}
              onOpen={openInstance}
            />
          ) : null}

          {view === "budget" ? <BudgetView /> : null}
        </div>
      </main>

      {panel.held ? (
        panel.held.task.tags.includes("note") ? (
          <NotePanel
            instance={panel.held}
            closing={panel.closing}
            onClose={() => setSelection(null)}
          />
        ) : (
          <TaskPanel
            instance={panel.held}
            closing={panel.closing}
            onClose={() => setSelection(null)}
            onOpenTask={(taskId) => openTaskId(taskId)}
          />
        )
      ) : null}

      {quickAdd ? (
        <QuickAdd
          defaultDate={quickAdd.date}
          defaultTime={quickAdd.time}
          onClose={() => setQuickAdd(null)}
          onCreated={(taskId) => openTaskId(taskId)}
        />
      ) : null}

      {spendOpen ? (
        <SpendCapture
          onClose={() => setSpendOpen(false)}
          onOpenBudget={() => setView("budget")}
        />
      ) : null}

      {dayPromptOpen ? (
        <DaySpendPrompt onClose={() => setDayPromptOpen(false)} />
      ) : null}

      {settingsOpen ? (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      ) : null}

      <UndoToast />

      <ReminderAlerts
        alerts={alerts}
        onDismiss={dismissAlert}
        onOpen={(taskId, occurrenceDate) => openTaskId(taskId, occurrenceDate)}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onView={setView}
        onNewTask={() => setQuickAdd({ date: anchor, time: null })}
        onNewSpend={() => setSpendOpen(true)}
        onOpenTask={(taskId) => openTaskId(taskId)}
        onSettings={() => setSettingsOpen(true)}
      />

      <AuthModal />
    </div>
  );
}
