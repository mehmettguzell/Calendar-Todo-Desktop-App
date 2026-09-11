import { toLocalDate } from "@/domain/datetime";
import type { LocalDate, Settings, TaskInstance } from "@/domain/types";
import type { ActiveAlert } from "@/services/scheduler";
import { Sidebar, type ViewId } from "@/ui/Sidebar";
import { Topbar } from "@/ui/Topbar";
import type { TranslationKey } from "@/lib/i18n";
import { calendarTitle, stepAnchor } from "@/ui/views/CalendarView";
import { AppOverlays } from "./AppOverlays";
import { DetailPanel } from "./DetailPanel";
import { ViewBody } from "./ViewBody";
import type { useOverlayState, useShellState } from "./shellState";

type Shell = ReturnType<typeof useShellState>;
type Overlays = ReturnType<typeof useOverlayState>;

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

export interface AppFrameProps {
  shell: Shell;
  overlays: Overlays;
  settings: Settings;
  selected: TaskInstance | null;
  panel: { held: TaskInstance | null; closing: boolean };
  alerts: ActiveAlert[];
  onDismissAlert: (id: string) => void;
  onOpenInstance: (instance: TaskInstance) => void;
  onOpenTask: (taskId: string, occurrenceDate?: LocalDate | null) => void;
  t: (key: TranslationKey) => string;
}

/** The whole window: nav, page, detail panel, overlays. */
export function AppFrame(props: AppFrameProps) {
  const { shell, overlays, selected, panel, settings, t } = props;
  const title =
    shell.view === "calendar"
      ? calendarTitle(shell.mode, shell.anchor, settings.weekStartsOn)
      : t(VIEW_TITLE_KEYS[shell.view]);

  return (
    <div className={selected ? "app has-panel" : "app"}>
      <Sidebar
        view={shell.view}
        onView={shell.setView}
        anchor={shell.anchor}
        onAnchor={shell.setAnchor}
        filters={shell.filters}
        onFilters={shell.setFilters}
        onSettings={() => overlays.setSettingsOpen(true)}
      />

      <main className="main">
        <Topbar
          view={shell.view}
          title={title}
          mode={shell.mode}
          onMode={shell.setMode}
          onStep={(direction) =>
            shell.setAnchor(stepAnchor(shell.mode, shell.anchor, direction))
          }
          onToday={() => shell.setAnchor(toLocalDate(new Date()))}
          filters={shell.filters}
          onFilters={shell.setFilters}
          onNewTask={() =>
            overlays.setQuickAdd({ date: shell.anchor, time: null })
          }
        />

        <div className="view-body scroll">
          <ViewBody
            view={shell.view}
            mode={shell.mode}
            anchor={shell.anchor}
            filters={shell.filters}
            selectedKey={selected?.key ?? null}
            daySelection={shell.daySelection}
            onSelectDate={shell.setDaySelection}
            onOpen={props.onOpenInstance}
            onQuickAdd={(date, time) => overlays.setQuickAdd({ date, time })}
            onView={shell.setView}
            onAnchor={shell.setAnchor}
          />
        </div>
      </main>

      <DetailPanel
        held={panel.held}
        closing={panel.closing}
        maximized={shell.panelMaximized}
        onClose={() => shell.setSelection(null)}
        onToggleMaximize={() => shell.setPanelMaximized(!shell.panelMaximized)}
        onOpenTask={(taskId) => props.onOpenTask(taskId)}
      />

      <AppOverlays
        state={{
          quickAdd: overlays.quickAdd,
          spendOpen: overlays.spendOpen,
          dayPromptOpen: overlays.dayPromptOpen,
          settingsOpen: overlays.settingsOpen,
          paletteOpen: overlays.paletteOpen,
          editingDeadline: overlays.editingDeadline,
          anchor: shell.anchor,
          alerts: props.alerts,
        }}
        on={{
          onCloseQuickAdd: () => overlays.setQuickAdd(null),
          onCloseSpend: () => overlays.setSpendOpen(false),
          onCloseDayPrompt: () => overlays.setDayPromptOpen(false),
          onCloseSettings: () => overlays.setSettingsOpen(false),
          onClosePalette: () => overlays.setPaletteOpen(false),
          onCloseDeadline: () => overlays.setEditingDeadline(null),
          onOpenSettings: () => overlays.setSettingsOpen(true),
          onOpenQuickAdd: overlays.setQuickAdd,
          onOpenSpend: () => overlays.setSpendOpen(true),
          onOpenTask: props.onOpenTask,
          onView: shell.setView,
          onDismissAlert: props.onDismissAlert,
        }}
      />
    </div>
  );
}
