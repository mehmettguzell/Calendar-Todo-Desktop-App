import { useEffect, useMemo, useState } from "react";
import { toLocalDate } from "@/domain/datetime";
import { occurrenceId } from "@/domain/ids";
import { toInstance } from "@/domain/task";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { ensureNotificationPermission } from "@/services/notifications";
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
import { ActivityView } from "@/ui/views/ActivityView";
import {
  CalendarView,
  calendarTitle,
  stepAnchor,
  type CalendarMode,
} from "@/ui/views/CalendarView";
import { FocusView } from "@/ui/views/FocusView";
import { TasksView } from "@/ui/views/TasksView";
import { PlansView } from "@/ui/views/PlansView";
import { NotesView } from "@/ui/views/NotesView";
import { TodayView } from "@/ui/views/TodayView";
import { useApplyTheme, useShortcuts } from "@/ui/hooks";

/** The selected task, remembered as a reference rather than a snapshot. */
interface Selection {
  taskId: string;
  occurrenceDate: LocalDate | null;
}

interface QuickAddSeed {
  date: LocalDate | null;
  time: string | null;
}

const VIEW_TITLES: Record<ViewId, string> = {
  today: "Today",
  calendar: "Calendar",
  tasks: "Tasks",
  plans: "Plans",
  notes: "Notes",
  focus: "Focus",
  activity: "Activity",
};

export function App() {
  const ready = useStore((s) => s.ready);
  const hydrate = useStore((s) => s.hydrate);
  const tasks = useStore((s) => s.db.tasks);
  const settings = useStore((s) => s.db.settings);
  const occurrences = useOccurrenceIndex();
  const now = useNow();

  const [view, setView] = useState<ViewId>("today");
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<LocalDate>(() =>
    toLocalDate(new Date()),
  );
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddSeed | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { alerts, dismissAlert } = useReminderScheduler();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (ready) void ensureNotificationPermission();
  }, [ready]);

  useApplyTheme(settings.theme);
  useShortcuts({
    onNew: () => setQuickAdd({ date: anchor, time: null }),
    onToday: () => {
      setAnchor(toLocalDate(new Date()));
      setView("today");
    },
    onEscape: () => setSelection(null),
  });

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
      : VIEW_TITLES[view];

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
            <NotesView selectedKey={selected?.key ?? null} onOpen={openInstance} />
          ) : null}

          {view === "focus" ? (
            <FocusView
              filters={filters}
              selectedKey={selected?.key ?? null}
              onOpen={openInstance}
            />
          ) : null}

          {view === "activity" ? <ActivityView /> : null}
        </div>
      </main>

      {selected ? (
        selected.task.tags.includes("note") ? (
          <NotePanel
            instance={selected}
            onClose={() => setSelection(null)}
          />
        ) : (
          <TaskPanel
            instance={selected}
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

      {settingsOpen ? (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      ) : null}

      <ReminderAlerts
        alerts={alerts}
        onDismiss={dismissAlert}
        onOpen={(taskId, occurrenceDate) => openTaskId(taskId, occurrenceDate)}
      />
    </div>
  );
}
