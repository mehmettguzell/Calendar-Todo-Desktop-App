import { useRef, useState } from "react";
import { toLocalDate } from "@/domain/datetime";
import { planProgress, planStage } from "@/domain/plan";
import { toInstance } from "@/domain/task";
import type { Task, TaskInstance } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { useSelectionStore } from "@/state/selectionStore";
import { useCategoryIndex } from "@/state/selectors";
import { useStore } from "@/state/store";
import { type RowReorder, useListReorder } from "@/ui/task/useListReorder";
import { useRequestDelete } from "@/ui/task/useRequestDelete";

/** Rows a plan card shows before the rest fold behind "+N daha". */
const SUBTASK_PREVIEW_COUNT = 5;

export interface PlanCardInput {
  plan: Task;
  subtasks: Task[];
  /** The cards on screen, in the order drawn — what a Shift-click spans. */
  planIds: string[];
  onOpen: (instance: TaskInstance) => void;
  now: Date;
  reorder?: RowReorder;
}

/**
 * Whether a click on this card is a pick rather than an open.
 *
 * While selecting, every plain click on a card or a step means "pick me" —
 * opening one would throw away a selection someone is halfway through building.
 * Before selecting has started, a modifier click is what asks for it, the same
 * gesture every desktop file list already uses.
 */
function usePlanPicking(plan: Task, planIds: string[], openPlan: () => void) {
  const picking = useSelectionStore((s) => s.active);
  const pickedIds = useSelectionStore((s) => s.ids);
  const pick = useSelectionStore((s) => s.pick);

  const pickIf = (
    e: React.MouseEvent,
    taskId: string,
    listIds: string[],
  ): boolean => {
    if (!picking && !e.ctrlKey && !e.metaKey && !e.shiftKey) return false;
    e.preventDefault();
    e.stopPropagation();
    pick(taskId, { listIds, range: e.shiftKey });
    return true;
  };

  return {
    picking,
    pickedIds,
    pick,
    pickIf,
    planPicked: pickedIds.includes(plan.id),
    activatePlan: (e: React.MouseEvent) => {
      if (pickIf(e, plan.id, planIds)) return;
      openPlan();
    },
  };
}

/**
 * The step list, and what is folded away.
 *
 * Cards stay close in height when long checklists collapse behind a "+N more"
 * row, which beats an inner scrollbar inside a card.
 */
function usePlanSteps(plan: Task, subtasks: Task[]) {
  const createTask = useStore((s) => s.createTask);
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const [expanded, setExpanded] = useState(true);
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const visibleSubtasks = showAllSubtasks
    ? subtasks
    : subtasks.slice(0, SUBTASK_PREVIEW_COUNT);

  /*
   * The whole list is handed to the hook, not just the rows on screen.
   *
   * `reorderSubtasks` renumbers every id it is given into a dense 0..n-1 run and
   * leaves the rest alone, so passing only the visible slice would give the rows
   * hidden behind "+N more" stale numbers that collide with the new ones. Visible
   * rows are a prefix of the full list, so their indices already line up.
   */
  const subtaskReorder = useListReorder({
    listId: `plan:${plan.id}`,
    ids: subtasks.map((sub) => sub.id),
    onReorder: (orderedIds) => reorderSubtasks(plan.id, orderedIds),
  });

  return {
    expanded,
    setExpanded,
    showAllSubtasks,
    setShowAllSubtasks,
    visibleSubtasks,
    hiddenSubtaskCount: subtasks.length - visibleSubtasks.length,
    newSubtask,
    setNewSubtask,
    subtaskReorder,
    handleAddSubtask: () => {
      const trimmed = newSubtask.trim();
      if (!trimmed) return;
      createTask({ title: trimmed, parentId: plan.id, dueDate: null, allDay: true });
      setNewSubtask("");
    },
  };
}

/** The one menu behind the card's title, and the native date picker it opens. */
function usePlanMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const deadlineRef = useRef<HTMLInputElement>(null);

  return {
    menuOpen,
    setMenuOpen,
    deadlineRef,
    runFromMenu: (action: () => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      setMenuOpen(false);
      action();
    },
    /*
     * `showPicker` throws when the browser has no such method, or refuses outside
     * a user gesture; focusing the input is the honest fallback, since a focused
     * date input can still be typed into.
     */
    openDeadlinePicker: () => {
      const input = deadlineRef.current;
      if (!input) return;
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
    },
  };
}

/** The card is draggable only where the list gave it handlers. */
function dragProps(reorder: RowReorder | undefined) {
  const {
    onGripKeyDown: onPlanGripKeyDown,
    className: planDragClass,
    ...planDragHandlers
  } = reorder ?? ({} as Partial<RowReorder>);
  return { onPlanGripKeyDown, planDragClass, planDragHandlers };
}

/** What the plan is, as the card needs to read it. */
function planFacts(plan: Task, subtasks: Task[], today: string) {
  const stage = planStage(plan, subtasks);
  const progress = planProgress(plan, subtasks);
  return {
    stage,
    isPlanCompleted: stage === "COMPLETED",
    isPlanToday: plan.dueDate === today,
    // A plan is late by its deadline alone: it has no schedule to be late against.
    planOverdue: plan.deadline != null && plan.deadline < today,
    doneSubtasks: progress.done,
    totalSubtasks: progress.total,
    progressPct: progress.pct,
  };
}

/**
 * Everything one plan card needs, computed once.
 *
 * The card's three sections all read from this, so the rules — what a click
 * means while picking, which stage the plan is in, how many steps are hidden —
 * live in one place instead of being restated per section.
 */
export function usePlanCard(input: PlanCardInput) {
  const { plan, subtasks, planIds, onOpen, now, reorder } = input;
  const { t } = useI18n();
  const toggleComplete = useStore((s) => s.toggleComplete);
  const updateTask = useStore((s) => s.updateTask);
  const setStatus = useStore((s) => s.setStatus);
  const requestDelete = useRequestDelete();
  const categories = useCategoryIndex();

  const today = toLocalDate(now);
  const openPlan = () => onOpen(toInstance(plan, null, null, now));
  const selection = usePlanPicking(plan, planIds, openPlan);
  const steps = usePlanSteps(plan, subtasks);
  const menu = usePlanMenu();

  const facts = planFacts(plan, subtasks, today);
  const { stage, isPlanToday } = facts;

  /**
   * Starting a plan is an ordinary status change (spec section 5), so it carries
   * its own history entry and syncs as one field. A finished plan does not offer
   * it: the answer to "have you started" is already yes.
   */
  const toggleStarted = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus(
      { taskId: plan.id, occurrenceDate: null },
      stage === "STARTED" ? "TODO" : "IN_PROGRESS",
    );
  };

  return {
    ...selection,
    ...steps,
    ...menu,
    ...dragProps(reorder),
    plan,
    subtasks,
    planIds,
    now,
    t,
    onOpen,
    stepIds: subtasks.map((step) => step.id),
    today,
    openPlan,
    togglePlanToday: () =>
      updateTask(plan.id, { dueDate: isPlanToday ? null : today, allDay: true }),
    toggleComplete,
    toggleStarted,
    updateTask,
    requestDelete,
    ...facts,
    category: plan.categoryId ? categories.get(plan.categoryId) : null,
    reorder,
  };
}

export type PlanCardModel = ReturnType<typeof usePlanCard>;
