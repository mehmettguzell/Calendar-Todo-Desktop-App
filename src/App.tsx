import { useEffect } from "react";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { useReminderScheduler } from "@/services/scheduler";
import { useNow, useStore } from "@/state/store";
import { useI18n } from "@/lib/i18n";
import { AppFrame } from "@/ui/app/AppFrame";
import {
  useBootstrap,
  useDesktopTriggers,
  useEveningPrompt,
} from "@/ui/app/effects";
import {
  useOverlayState,
  useSelectedInstance,
  useShellState,
} from "@/ui/app/shellState";
import { useAppShortcuts } from "@/ui/app/shortcuts";
import { useApplyLanguage, useApplyTheme } from "@/ui/hooks";
import { focusComposer } from "@/ui/task/Composer";

/**
 * Wires the shell together and renders it.
 *
 * Nothing here draws: the state lives in `shellState`, the effects in `effects`,
 * the keyboard in `shortcuts`, and the tree in `AppFrame`. What is left is the
 * order those are arranged in, which is the one thing this file is about.
 */
export function App() {
  const ready = useStore((s) => s.ready);
  const settings = useStore((s) => s.db.settings);
  const now = useNow();
  const { t, language } = useI18n();

  const shell = useShellState();
  const overlays = useOverlayState();
  const { alerts, dismissAlert } = useReminderScheduler();
  const { selected, panel } = useSelectedInstance(shell.selection);

  useBootstrap();
  useDesktopTriggers({
    onQuickAdd: (date) => overlays.setQuickAdd({ date, time: null }),
    onQuickSpend: () => overlays.setSpendOpen(true),
  });
  useEveningPrompt({
    ready,
    now,
    settings,
    alreadyOpen: overlays.dayPromptOpen,
    onOpen: () => overlays.setDayPromptOpen(true),
    t,
  });
  useApplyTheme(settings.theme);
  useApplyLanguage(language);

  // Nothing selected, nothing to maximise. Left set, the next task would open
  // full-screen without having been asked to.
  const { setPanelMaximized } = shell;
  useEffect(() => {
    if (!selected) setPanelMaximized(false);
  }, [selected, setPanelMaximized]);

  /** A deadline marker is not the task it belongs to, so it opens its own editor. */
  const openInstance = (instance: TaskInstance) => {
    if (instance.deadlineId) {
      overlays.setEditingDeadline({
        taskId: instance.task.id,
        deadlineId: instance.deadlineId,
      });
      return;
    }
    shell.setSelection({
      taskId: instance.task.id,
      occurrenceDate: instance.isRecurring ? instance.date : null,
    });
  };

  const openTaskId = (taskId: string, occurrenceDate: LocalDate | null = null) =>
    shell.setSelection({ taskId, occurrenceDate });

  useAppShortcuts({
    anchor: shell.anchor,
    daySelection: shell.daySelection,
    selected,
    panelMaximized: shell.panelMaximized,
    setAnchor: shell.setAnchor,
    setView: shell.setView,
    setQuickAdd: overlays.setQuickAdd,
    setPanelMaximized: shell.setPanelMaximized,
    setSelection: shell.setSelection,
    togglePalette: () => overlays.setPaletteOpen(!overlays.paletteOpen),
    focusComposer,
  });

  if (!ready) {
    return (
      <div className="loading">
        <span className="spinner" />
        {t("loadingTasks")}
      </div>
    );
  }

  return (
    <AppFrame
      shell={shell}
      overlays={overlays}
      settings={settings}
      selected={selected}
      panel={panel}
      alerts={alerts}
      onDismissAlert={dismissAlert}
      onOpenInstance={openInstance}
      onOpenTask={openTaskId}
      t={t}
    />
  );
}
