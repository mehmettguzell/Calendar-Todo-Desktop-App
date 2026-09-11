import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  weekdayNames,
} from "@/domain/datetime";
import { describeRecurrence } from "@/domain/recurrence";
import { plansAcceptingTask } from "@/domain/task";
import { useI18n } from "@/lib/i18n";
import {
  type TaskInstance,
} from "@/domain/types";
import {
  useCategories,
  useSubtasks,
  useTaskHistory,
  useTrackedSeconds,
  useTaskById,
} from "@/state/selectors";
import { useStore } from "@/state/store";
import { useClipboardStore } from "@/state/clipboardStore";
import { taskResistance } from "@/domain/resistance";
import { useRequestDelete } from "../useRequestDelete";
export interface TaskPanelInput {
  instance: TaskInstance;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  maximized: boolean;
  onToggleMaximize?: () => void;
}
import type { Task } from "@/domain/types";

/**
 * Everything the panel's four bands read.
 *
 * The panel is one task shown five ways — head, fields, folded sections,
 * resistance, footer — and each band needs most of the same answers. Computing
 * them once here is what keeps the bands from disagreeing about the task's state.
 */
/** Every store mutation the panel offers, in one read. */
function usePanelActions() {
  return {
    updateTask: useStore((s) => s.updateTask),
    toggleComplete: useStore((s) => s.toggleComplete),
    clearSnooze: useStore((s) => s.clearSnooze),
    reschedule: useStore((s) => s.reschedule),
    setParent: useStore((s) => s.setParent),
    makePlan: useStore((s) => s.makePlan),
    createTask: useStore((s) => s.createTask),
    startFocus: useStore((s) => s.startFocus),
    stopFocus: useStore((s) => s.stopFocus),
    pauseFocus: useStore((s) => s.pauseFocus),
    resumeFocus: useStore((s) => s.resumeFocus),
    convertToNote: useStore((s) => s.convertToNote),
    requestDelete: useRequestDelete(),
  };
}

/**
 * What each folded section holds, said in one phrase.
 *
 * This is what makes folding honest rather than hiding: a shut section still
 * tells you there are two reminders on this task, so nothing is lost by leaving
 * it shut.
 */
function usePanelSummaries(task: Task, subtasks: Task[], tracked: number) {
  const { t } = useI18n();
  const reminders = useStore((s) => s.db.reminders);
  const allTasks = useStore((s) => s.db.tasks);
  const history = useTaskHistory(task.id);

  const taskReminders = useMemo(
    () => reminders.filter((r) => r.taskId === task.id && r.status !== "DISMISSED"),
    [reminders, task.id],
  );
  const repeatSummary = useMemo(() => {
    if (task.recurrence) {
      return describeRecurrence(task.recurrence, t, weekdayNames("short"), task.dueDate);
    }
    return task.endDate ? t("formEndDate") : null;
  }, [task.recurrence, task.endDate, task.dueDate, t]);

  /**
   * How the estimate held up.
   *
   * Only shown once there is something to compare — an untouched timer would
   * otherwise report every task as 100% under budget.
   */
  const estimateDelta = useMemo(() => {
    const estimate = task.estimateMinutes ?? 0;
    if (estimate <= 0 || tracked <= 0) return null;
    const actual = Math.round(tracked / 60);
    const ratio = Math.round((actual / estimate) * 100);
    return {
      over: actual > estimate,
      label: `${actual}/${estimate} ${t("minutesShort")} · %${ratio}`,
    };
  }, [task.estimateMinutes, tracked, t]);

  return {
    t,
    history,
    taskReminders,
    repeatSummary,
    estimateDelta,
    doneSubtasks: subtasks.filter((s) => s.status === "COMPLETED").length,
    isPlan: task.tags.includes("plan") && task.parentId === null,
    openPlans: plansAcceptingTask(allTasks, task),
    /**
     * What the task's own history says about how it is going. Reading only —
     * below three postponements this is `none` and the panel is unchanged.
     */
    resistance: taskResistance(history),
  };
}

/**
 * The panel's own text fields, re-seeded whenever a different task is opened.
 *
 * The title is a textarea so a long name wraps into view instead of scrolling
 * sideways inside a one-line input. Nothing else about it is multi-line: it grows
 * to exactly its content, and Enter commits rather than adding a break.
 */
function usePanelDraft(task: Task, updateTask: (id: string, patch: { title: string }) => void) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [tagInput, setTagInput] = useState(task.tags.join(", "));
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setTagInput(task.tags.join(", "));
  }, [task.id, task.title, task.description, task.tags]);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  return {
    title,
    setTitle,
    titleRef,
    description,
    setDescription,
    tagInput,
    setTagInput,
    commitTitle: () => {
      const trimmed = title.trim();
      if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed });
      else if (!trimmed) setTitle(task.title);
    },
  };
}

/** The three menus the footer opens, none of which outlive the panel. */
function usePanelMenus() {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  return {
    snoozeOpen,
    setSnoozeOpen,
    planMenuOpen,
    setPlanMenuOpen,
    moreMenuOpen,
    setMoreMenuOpen,
  };
}

export function useTaskPanel(input: TaskPanelInput) {
  const { instance, onClose, onOpenTask, maximized, onToggleMaximize } = input;
  const { task } = instance;

  const actions = usePanelActions();
  const tracked = useTrackedSeconds(task.id);
  const subtasks = useSubtasks(task.id);
  const summaries = usePanelSummaries(task, subtasks, tracked);
  const draft = usePanelDraft(task, actions.updateTask);
  const menus = usePanelMenus();

  const runningFocus = useStore((s) => s.runningFocus);
  const isFocused = runningFocus?.taskId === task.id;
  const ref = useMemo(
    () => ({
      taskId: task.id,
      occurrenceDate: instance.isRecurring ? instance.date : null,
    }),
    [task.id, instance.isRecurring, instance.date],
  );

  return {
    ...actions,
    ...summaries,
    ...draft,
    ...menus,
    instance,
    onClose,
    onOpenTask,
    maximized,
    onToggleMaximize,
    task,
    subtasks,
    tracked,
    runningFocus,
    isFocused,
    isPaused: isFocused && runningFocus?.runStartedAt === null,
    ref,
    copyToClipboard: useClipboardStore((s) => s.copy),
    clip: useClipboardStore((s) => s.clip),
    categories: useCategories(),
    parentTask: useTaskById(task.parentId),
  };
}

export type TaskPanelModel = ReturnType<typeof useTaskPanel>;
