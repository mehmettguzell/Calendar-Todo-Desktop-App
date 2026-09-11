import type { LocalDate } from "@/domain/types";
import type { ActiveAlert } from "@/services/scheduler";
import { DaySpendPrompt } from "@/ui/budget/DaySpendPrompt";
import { SpendCapture } from "@/ui/budget/SpendCapture";
import { AuthModal } from "@/ui/components/AuthModal";
import { CommandPalette } from "@/ui/components/CommandPalette";
import { ReminderAlerts } from "@/ui/components/ReminderAlerts";
import { UndoToast } from "@/ui/components/UndoToast";
import { UpdateGate } from "@/ui/components/UpdateGate";
import { SettingsModal } from "@/ui/SettingsModal";
import { BulkActionBar } from "@/ui/task/BulkActionBar";
import { DeadlineEditor } from "@/ui/task/DeadlineEditor";
import { QuickAdd } from "@/ui/task/QuickAdd";
import type { ViewId } from "@/ui/Sidebar";

export interface QuickAddSeed {
  /** Null where the caller has no day in mind; QuickAdd then picks today. */
  date: LocalDate | null;
  time: string | null;
}

export interface OverlayState {
  quickAdd: QuickAddSeed | null;
  spendOpen: boolean;
  dayPromptOpen: boolean;
  settingsOpen: boolean;
  paletteOpen: boolean;
  editingDeadline: { taskId: string; deadlineId: string } | null;
  anchor: LocalDate;
  alerts: ActiveAlert[];
}

export interface OverlayHandlers {
  onCloseQuickAdd: () => void;
  onCloseSpend: () => void;
  onCloseDayPrompt: () => void;
  onCloseSettings: () => void;
  onClosePalette: () => void;
  onCloseDeadline: () => void;
  onOpenSettings: () => void;
  onOpenQuickAdd: (seed: QuickAddSeed) => void;
  onOpenSpend: () => void;
  onOpenTask: (taskId: string, occurrenceDate?: LocalDate | null) => void;
  onView: (view: ViewId) => void;
  onDismissAlert: (id: string) => void;
}

/** Adding a spend, and the evening prompt that asks whether there was one. */
function SpendOverlays({ state, on }: { state: OverlayState; on: OverlayHandlers }) {
  return (
    <>
      {state.spendOpen ? (
        <SpendCapture
          onClose={on.onCloseSpend}
          onOpenBudget={() => on.onView("budget")}
        />
      ) : null}
      {state.dayPromptOpen ? <DaySpendPrompt onClose={on.onCloseDayPrompt} /> : null}
      {state.settingsOpen ? <SettingsModal onClose={on.onCloseSettings} /> : null}
    </>
  );
}

/**
 * Everything that floats above the page.
 *
 * Order is layering: `UpdateGate` is last because a mandatory update has to
 * cover the modals too, not just the page behind them.
 */
export function AppOverlays({
  state,
  on,
}: {
  state: OverlayState;
  on: OverlayHandlers;
}) {
  return (
    <>
      {state.quickAdd ? (
        <QuickAdd
          defaultDate={state.quickAdd.date}
          defaultTime={state.quickAdd.time}
          onClose={on.onCloseQuickAdd}
          onCreated={(taskId) => on.onOpenTask(taskId)}
        />
      ) : null}

      <SpendOverlays state={state} on={on} />

      <BulkActionBar />
      <UndoToast />
      <UpdateGate />

      <ReminderAlerts
        alerts={state.alerts}
        onDismiss={on.onDismissAlert}
        onOpen={(taskId, occurrenceDate) => on.onOpenTask(taskId, occurrenceDate)}
      />

      <CommandPalette
        open={state.paletteOpen}
        onClose={on.onClosePalette}
        onView={on.onView}
        onNewTask={() => on.onOpenQuickAdd({ date: state.anchor, time: null })}
        onNewSpend={on.onOpenSpend}
        onOpenTask={(taskId) => on.onOpenTask(taskId)}
        onSettings={on.onOpenSettings}
      />

      {state.editingDeadline ? (
        <DeadlineEditor
          taskId={state.editingDeadline.taskId}
          deadlineId={state.editingDeadline.deadlineId}
          onClose={on.onCloseDeadline}
        />
      ) : null}

      <AuthModal />
    </>
  );
}
