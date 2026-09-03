import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Flag,
  ChevronRight,
  GripVertical,
  Lightbulb,
  MousePointerClick,
  Plus,
  Sun,
  X,
  Target,
  Timer,
  Trash2,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { isMissed, type Deadline } from "@/domain/deadline";
import { arrangePinned, pinOf } from "@/domain/manualOrder";
import {
  PRIORITIES,
  type Priority,
  type Task,
  type TaskInstance,
} from "@/domain/types";
import { toInstance } from "@/domain/task";
import {
  compareSteps,
  useCategories,
  useCategoryIndex,
  useDeadlines,
  useLiveTasks,
} from "@/state/selectors";
import { useSelectionStore } from "@/state/selectionStore";
import { useNow, useStore } from "@/state/store";
import { useListReorder, type RowReorder } from "@/ui/task/useListReorder";
import { ResetOrderButton } from "@/ui/task/ResetOrderButton";
import { Checkbox, Field, Modal } from "@/ui/components/primitives";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useRequestDelete } from "@/ui/task/useRequestDelete";
import { DeadlineEditor } from "@/ui/task/DeadlineEditor";

type PlanFilter = "ALL" | "ACTIVE" | "COMPLETED";

/** Rows a plan card shows before the rest fold behind "+N daha". */
const SUBTASK_PREVIEW_COUNT = 5;

interface PlanStarter {
  id: string;
  emoji: string;
  /** Which seeded category it files under, in either language. */
  categoryKey: keyof typeof STARTER_CATEGORY_NAMES;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  stepKeys: TranslationKey[];
}

/**
 * A starter files itself under a seeded category, and the seeds are named in
 * whatever language the app was first opened in. Matching on both spellings
 * means a template still lands in the right place after the language is
 * switched, or on a document created before it was.
 */
const STARTER_CATEGORY_NAMES = {
  health: ["Health", "Sağlık"],
  work: ["Work", "İş"],
  personal: ["Personal", "Kişisel"],
} as const;

const PLAN_STARTERS: PlanStarter[] = [
  {
    id: "fitness",
    emoji: "🎯",
    categoryKey: "health",
    titleKey: "planTplFitnessTitle",
    descKey: "planTplFitnessDesc",
    stepKeys: [
      "planTplFitnessStep1",
      "planTplFitnessStep2",
      "planTplFitnessStep3",
      "planTplFitnessStep4",
    ],
  },
  {
    id: "project",
    emoji: "🚀",
    categoryKey: "work",
    titleKey: "planTplProjectTitle",
    descKey: "planTplProjectDesc",
    stepKeys: [
      "planTplProjectStep1",
      "planTplProjectStep2",
      "planTplProjectStep3",
      "planTplProjectStep4",
    ],
  },
  {
    id: "learning",
    emoji: "📚",
    categoryKey: "personal",
    titleKey: "planTplLearningTitle",
    descKey: "planTplLearningDesc",
    stepKeys: [
      "planTplLearningStep1",
      "planTplLearningStep2",
      "planTplLearningStep3",
    ],
  },
  {
    id: "habits",
    emoji: "✨",
    categoryKey: "personal",
    titleKey: "planTplHabitsTitle",
    descKey: "planTplHabitsDesc",
    stepKeys: [
      "planTplHabitsStep1",
      "planTplHabitsStep2",
      "planTplHabitsStep3",
    ],
  },
];

export function PlansView({
  selectedKey,
  onOpen,
}: {
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const tasks = useLiveTasks();
  const createTask = useStore((s) => s.createTask);
  const reorderTasks = useStore((s) => s.reorderTasks);
  const now = useNow();
  const { t } = useI18n();
  const categories = useCategories();

  const selecting = useSelectionStore((s) => s.active);
  const pickedCount = useSelectionStore((s) => s.ids.length);
  const beginSelecting = useSelectionStore((s) => s.begin);
  const clearSelection = useSelectionStore((s) => s.clear);
  const replaceSelection = useSelectionStore((s) => s.replace);

  const [filter, setFilter] = useState<PlanFilter>("ALL");
  const [newPlanModal, setNewPlanModal] = useState(false);
  const [inlineTitle, setInlineTitle] = useState("");

  const plans = useMemo(() => {
    const raw = tasks
      .filter((t) => t.tags.includes("plan") && !t.parentId)
      .sort((a, b) => a.order - b.order);
    return arrangePinned(raw, pinOf);
  }, [tasks]);

  const subtasksMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parentId) {
        const list = map.get(t.parentId);
        if (list) list.push(t);
        else map.set(t.parentId, [t]);
      }
    }
    // The same arrangement `useSubtasks` uses — otherwise a card and the task
    // panel would show one plan's steps in two different orders.
    for (const list of map.values()) list.sort(compareSteps);
    return map;
  }, [tasks]);

  const visiblePlans = useMemo(() => {
    return plans.filter((plan) => {
      const subtasks = subtasksMap.get(plan.id) ?? [];
      const isCompleted =
        plan.status === "COMPLETED" ||
        (subtasks.length > 0 &&
          subtasks.every((s) => s.status === "COMPLETED"));

      if (filter === "ACTIVE") return !isCompleted;
      if (filter === "COMPLETED") return isCompleted;
      return true;
    });
  }, [plans, subtasksMap, filter]);

  const planIds = useMemo(() => visiblePlans.map((p) => p.id), [visiblePlans]);

  /**
   * What the quick-select buttons reach: every plan currently on screen and
   * every step under it, each tagged with whether it is finished.
   *
   * Steps are in because "delete the ones I have done" is mostly about steps —
   * a plan is rarely finished outright, while the checklist beneath it fills
   * up with ticked rows that nobody wants to keep scrolling past.
   */
  const pickable = useMemo(() => {
    const rows: { id: string; done: boolean }[] = [];
    for (const plan of visiblePlans) {
      const steps = subtasksMap.get(plan.id) ?? [];
      const planDone =
        plan.status === "COMPLETED" ||
        (steps.length > 0 && steps.every((s) => s.status === "COMPLETED"));
      rows.push({ id: plan.id, done: planDone });
      for (const step of steps) {
        rows.push({ id: step.id, done: step.status === "COMPLETED" });
      }
    }
    return rows;
  }, [visiblePlans, subtasksMap]);

  const pickWhere = (keep: (row: { done: boolean }) => boolean) =>
    replaceSelection(pickable.filter(keep).map((row) => row.id));

  const doneCount = pickable.filter((row) => row.done).length;
  const activeCount = pickable.length - doneCount;

  const planReorder = useListReorder({
    listId: "plans:grid",
    ids: planIds,
    onReorder: reorderTasks,
  });

  const handleQuickAdd = () => {
    const trimmed = inlineTitle.trim();
    if (!trimmed) return;
    const newPlan = createTask({
      title: trimmed,
      tags: ["plan"],
      dueDate: null,
      allDay: true,
      priority: "MEDIUM",
    });
    setInlineTitle("");
    onOpen(toInstance(newPlan, null, null, now));
  };

  const handleApplyStarter = (starter: PlanStarter) => {
    const cat = categories.find((c) =>
      (STARTER_CATEGORY_NAMES[starter.categoryKey] as readonly string[]).some(
        (name) => name.toLowerCase() === c.name.toLowerCase(),
      ),
    );
    const plan = createTask({
      title: `${starter.emoji} ${t(starter.titleKey)}`,
      description: t(starter.descKey),
      categoryId: cat ? cat.id : null,
      tags: ["plan"],
      priority: "HIGH",
      dueDate: null,
      allDay: true,
    });

    for (const key of starter.stepKeys) {
      createTask({
        title: t(key),
        parentId: plan.id,
        dueDate: null,
        allDay: true,
      });
    }

    onOpen(toInstance(plan, null, null, now));
  };

  return (
    <div className="page wide">
      {/* Plans Header & Filter Bar */}
      <div className="plans-header section">
        <div className="plans-title-box">
          <div className="plans-title-icon">
            <Target size={20} />
          </div>
          <div>
            <h2 className="plans-main-title">{t("plansTitle")}</h2>
            <p className="plans-subtitle">{t("plansSubtitle")}</p>
          </div>
        </div>

        <div className="plans-actions-row">
          <div className="plans-filter-tabs">
            <button
              type="button"
              className={cn("plan-tab-btn", filter === "ALL" && "active")}
              onClick={() => setFilter("ALL")}
            >
              {t("plansAll")} ({plans.length})
            </button>
            <button
              type="button"
              className={cn("plan-tab-btn", filter === "ACTIVE" && "active")}
              onClick={() => setFilter("ACTIVE")}
            >
              {t("plansActive")}
            </button>
            <button
              type="button"
              className={cn("plan-tab-btn", filter === "COMPLETED" && "active")}
              onClick={() => setFilter("COMPLETED")}
            >
              {t("plansCompleted")}
            </button>
          </div>

          <div className="row" style={{ gap: 6 }}>
            {/* The one visible door into selecting; a Ctrl-click on any card or
                step does the same for anyone who already knows the gesture. */}
            <button
              type="button"
              className={cn("btn ghost sm", selecting && "active")}
              style={{ gap: 6, padding: "5px 10px", fontSize: 12 }}
              aria-pressed={selecting}
              title={t("plansPickHint")}
              onClick={() => (selecting ? clearSelection() : beginSelecting())}
            >
              <MousePointerClick size={13} />
              {t("bulkSelect")}
            </button>
            <ResetOrderButton tasks={plans} />
            <button
              type="button"
              className="btn primary"
              onClick={() => setNewPlanModal(true)}
            >
              <Plus size={14} /> {t("plansNewButton")}
            </button>
          </div>
        </div>

        {/* Only while selecting. What is picked is acted on from the bulk bar
            at the bottom of the window, so this row is about picking alone. */}
        {selecting ? (
          <div className="plans-pick-bar" role="group" aria-label={t("bulkTitle")}>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => pickWhere(() => true)}
            >
              {t("plansPickAll")} ({pickable.length})
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={doneCount === 0}
              onClick={() => pickWhere((row) => row.done)}
            >
              <CheckCircle2 size={13} /> {t("plansPickDone")} ({doneCount})
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={activeCount === 0}
              onClick={() => pickWhere((row) => !row.done)}
            >
              {t("plansPickActive")} ({activeCount})
            </button>
            <span className="grow" />
            <span className="faint" style={{ fontSize: 12 }}>
              {t("plansPickCount", { n: pickedCount })}
            </span>
            <button
              type="button"
              className="btn ghost icon sm"
              aria-label={t("bulkClear")}
              title={`${t("bulkClear")} (Esc)`}
              onClick={clearSelection}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Inline Fast Add */}
      <div className="row section" style={{ gap: 8 }}>
        <input
          className="input grow"
          placeholder={t("plansQuickAdd")}
          value={inlineTitle}
          onChange={(e) => setInlineTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickAdd();
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={!inlineTitle.trim()}
          onClick={handleQuickAdd}
        >
          <Plus size={14} /> {t("plansQuickAddButton")}
        </button>
      </div>

      {/* Starter Templates if no plans */}
      {plans.length === 0 && (
        <div className="section">
          <div className="section-head" style={{ marginBottom: 12 }}>
            <Lightbulb size={14} />
            <h2>{t("plansStarterHeading")}</h2>
            <span className="faint" style={{ fontSize: 12 }}>
              {t("plansStarterHint")}
            </span>
          </div>
          <div className="plan-starters-grid">
            {PLAN_STARTERS.map((starter) => (
              <div
                key={starter.id}
                className="plan-starter-card"
                onClick={() => handleApplyStarter(starter)}
              >
                <div className="plan-starter-title">
                  {starter.emoji} {t(starter.titleKey)}
                </div>
                <div className="plan-starter-desc">{t(starter.descKey)}</div>
                <div className="plan-starter-sub-count">
                  {t("plansStarterSubCount", { n: starter.stepKeys.length })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plans Grid */}
      {visiblePlans.length === 0 && plans.length > 0 ? (
        <div
          className="card"
          style={{ padding: "32px 16px", textAlign: "center" }}
        >
          <p className="faint">Bu filtreye uygun plan bulunamadı.</p>
        </div>
      ) : (
        <div
          className={cn("plans-grid", planReorder.active && "reordering")}
          {...planReorder.containerProps}
        >
          {visiblePlans.map((plan, index) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              subtasks={subtasksMap.get(plan.id) ?? []}
              selected={plan.id === selectedKey}
              planIds={planIds}
              onOpen={onOpen}
              now={now}
              reorder={planReorder.row(index)}
            />
          ))}
        </div>
      )}

      {/* New Plan Dialog */}
      {newPlanModal && (
        <NewPlanModal
          categories={categories}
          onClose={() => setNewPlanModal(false)}
          onCreate={(
            title,
            description,
            categoryId,
            priority,
            initialSubtasks,
          ) => {
            const plan = createTask({
              title,
              description,
              categoryId,
              priority,
              tags: ["plan"],
              dueDate: null,
              allDay: true,
            });

            for (const sub of initialSubtasks) {
              if (sub.trim()) {
                createTask({
                  title: sub.trim(),
                  parentId: plan.id,
                  dueDate: null,
                  allDay: true,
                });
              }
            }

            setNewPlanModal(false);
            onOpen(toInstance(plan, null, null, now));
          }}
        />
      )}
    </div>
  );
}

function PlanCard({
  plan,
  subtasks,
  selected,
  planIds,
  onOpen,
  now,
  reorder,
}: {
  plan: Task;
  subtasks: Task[];
  selected: boolean;
  /** The cards on screen, in the order drawn — what a Shift-click spans. */
  planIds: string[];
  onOpen: (instance: TaskInstance) => void;
  now: Date;
  reorder?: RowReorder;
}) {
  const { t } = useI18n();
  const toggleComplete = useStore((s) => s.toggleComplete);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const requestDelete = useRequestDelete();
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const categories = useCategoryIndex();

  const picking = useSelectionStore((s) => s.active);
  const pickedIds = useSelectionStore((s) => s.ids);
  const pick = useSelectionStore((s) => s.pick);

  const [expanded, setExpanded] = useState(true);
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const deadlineRef = useRef<HTMLInputElement>(null);

  /**
   * Open the native date picker for this plan.
   *
   * `showPicker` throws when the browser has no such method, or refuses
   * outside a user gesture; focusing the input is the honest fallback, since a
   * focused date input can still be typed into.
   */
  const openDeadlinePicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    const input = deadlineRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  const today = toLocalDate(now);
  const isPlanToday = plan.dueDate === today;
  // A plan is late by its deadline alone: it has no schedule to be late against.
  const planOverdue = plan.deadline !== null && plan.deadline !== undefined && plan.deadline < today;
  const openPlan = () => onOpen(toInstance(plan, null, null, now));

  const planPicked = pickedIds.includes(plan.id);
  const stepIds = subtasks.map((step) => step.id);

  /**
   * Whether this click was a pick rather than an open.
   *
   * While selecting, every plain click on a card or a step means "pick me" —
   * opening one would throw away a selection someone is halfway through
   * building. Before selecting has started, a modifier click is what asks for
   * it, the same gesture every desktop file list already uses.
   */
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

  const activatePlan = (e: React.MouseEvent) => {
    if (pickIf(e, plan.id, planIds)) return;
    openPlan();
  };

  const togglePlanToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(plan.id, {
      dueDate: isPlanToday ? null : today,
      allDay: true,
    });
  };

  const category = plan.categoryId ? categories.get(plan.categoryId) : null;
  const doneSubtasks = subtasks.filter((s) => s.status === "COMPLETED").length;
  const totalSubtasks = subtasks.length;
  const isPlanCompleted =
    plan.status === "COMPLETED" ||
    (totalSubtasks > 0 && doneSubtasks === totalSubtasks);
  const progressPct =
    totalSubtasks > 0
      ? Math.round((doneSubtasks / totalSubtasks) * 100)
      : isPlanCompleted
        ? 100
        : 0;

  // Cards stay close in height when long checklists collapse behind a
  // "+N more" row, which beats an inner scrollbar inside a card.
  const visibleSubtasks = showAllSubtasks
    ? subtasks
    : subtasks.slice(0, SUBTASK_PREVIEW_COUNT);
  const hiddenSubtaskCount = subtasks.length - visibleSubtasks.length;

  /*
   * The whole list is handed to the hook, not just the rows on screen.
   *
   * `reorderSubtasks` renumbers every id it is given into a dense 0..n-1 run
   * and leaves the rest alone, so passing only the visible slice would give the
   * rows hidden behind "+N more" stale numbers that collide with the new ones.
   * Visible rows are a prefix of the full list, so their indices already line up.
   */
  const subtaskReorder = useListReorder({
    listId: `plan:${plan.id}`,
    ids: subtasks.map((sub) => sub.id),
    onReorder: (orderedIds) => reorderSubtasks(plan.id, orderedIds),
  });

  const {
    onGripKeyDown: onPlanGripKeyDown,
    className: planDragClass,
    ...planDragHandlers
  } = reorder ?? ({} as Partial<RowReorder>);

  const handleAddSubtask = () => {
    const trimmed = newSubtask.trim();
    if (!trimmed) return;
    createTask({
      title: trimmed,
      parentId: plan.id,
      dueDate: null,
      allDay: true,
    });
    setNewSubtask("");
  };

  return (
    <div
      className={cn(
        "plan-card",
        selected && "selected",
        isPlanCompleted && "completed",
        picking && "picking",
        planPicked && "picked",
        planDragClass,
      )}
      {...planDragHandlers}
    >
      {/* Plan Card Head */}
      <div className="plan-card-head">
        <div className="plan-card-title-row" onClick={activatePlan}>
          {picking ? (
            <label className="task-pick" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={planPicked}
                aria-label={t("bulkSelectAria", { title: plan.title })}
                onChange={() => pick(plan.id, { listIds: planIds })}
                onClick={(e) => {
                  if (e.shiftKey) {
                    e.preventDefault();
                    pick(plan.id, { listIds: planIds, range: true });
                  }
                }}
              />
            </label>
          ) : null}
          {reorder && (
            <div
              role="button"
              tabIndex={0}
              className="plan-card-grip"
              aria-label={t("taskReorderAria", { title: plan.title })}
              title={t("taskReorderHint")}
              onKeyDown={onPlanGripKeyDown}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </div>
          )}
          <Target
            size={18}
            className={cn(
              "plan-icon",
              isPlanCompleted ? "completed" : "active",
            )}
          />
          <h3 className="plan-card-title wrap">{plan.title}</h3>
          {totalSubtasks > 0 && (
            <span className="plan-card-count mono">
              {doneSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        <div className="plan-card-actions">
          {/* The picker has to be asked for by name. A date input tucked behind
              an icon does not open when its label is clicked — the browser only
              focuses it — so `showPicker` is what actually makes the button do
              something. The input stays in the DOM and unhidden to pointers so
              that a browser without `showPicker` still has something to fall
              back to. */}
          <span
            className="plan-deadline-control"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={cn("btn ghost icon sm", plan.deadline && "active")}
              title={plan.deadline ? t("deadlineOn", { date: plan.deadline }) : t("formDeadline")}
              aria-label={t("formDeadline")}
              onClick={openDeadlinePicker}
            >
              <Flag size={14} style={plan.deadline ? { color: "var(--accent)" } : undefined} />
            </button>
            <input
              ref={deadlineRef}
              type="date"
              className="plan-deadline-input"
              tabIndex={-1}
              value={plan.deadline ?? ""}
              aria-label={t("formDeadline")}
              onChange={(e) =>
                updateTask(plan.id, { deadline: e.target.value || null })
              }
            />
          </span>
          <button
            type="button"
            className={cn("btn ghost icon sm", isPlanToday && "active")}
            title={isPlanToday ? t("removeFromToday") : t("assignToToday")}
            onClick={togglePlanToday}
            style={isPlanToday ? { color: "#f59e0b" } : undefined}
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon sm"
            title={t("plansFocusOn")}
            onClick={openPlan}
          >
            <Timer size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon sm"
            title={t("plansDelete")}
            onClick={(e) => {
              e.stopPropagation();
              requestDelete(plan.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Plan Description & Meta */}
      {plan.description && (
        <p className="plan-card-desc" onClick={activatePlan}>
          {plan.description}
        </p>
      )}

      <div className="plan-card-meta-row" onClick={activatePlan}>
        {isPlanToday && (
          <span className="plan-today-pill" title={t("plansAddedToToday")}>
            <Sun size={11} /> {t("today")}
          </span>
        )}
        {category && (
          <span className="plan-category-pill">
            <i className="dot" style={{ background: category.color }} />
            {category.name}
          </span>
        )}
        {plan.priority !== "NONE" && (
          <span className={cn("plan-priority-tag", plan.priority)}>
            {t(`priority${plan.priority}`)}
          </span>
        )}
        {/* On the pill line rather than beside the name: a plan's title is the
            one thing that must never be the part that gets truncated. */}
        {plan.deadline && (
          <span
            className={cn("plan-card-deadline", planOverdue && "is-overdue")}
            title={t("deadlineOn", { date: plan.deadline })}
          >
            <Flag size={11} aria-hidden /> {plan.deadline}
          </span>
        )}
        {isPlanCompleted && (
          <span className="plan-status-pill success">
            <CheckCircle2 size={11} /> {t("statusCOMPLETED")}
          </span>
        )}
      </div>

      {/* Plan Progress */}
      <div className="plan-card-progress-section">
        <div className="plan-progress-track">
          <div
            className={cn(
              "plan-progress-bar",
              isPlanCompleted ? "completed" : "in-progress",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <PlanDeadlines taskId={plan.id} today={today} />

      {/* Subtasks Accordion */}
      <div className="plan-subtasks-section">
        <div
          className="plan-subtasks-head"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="plan-subtasks-toggle-title">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Alt Hedefler
          </span>
        </div>

        {expanded && (
          <div className="plan-subtasks-body">
            {subtasks.length === 0 ? (
              <div className="faint" style={{ fontSize: 12, padding: "4px 0" }}>
                Henüz alt hedef eklenmemiş.
              </div>
            ) : (
              <div {...subtaskReorder.containerProps}>
                {visibleSubtasks.map((sub, index) => {
                  const subDone = sub.status === "COMPLETED";
                  const subInstance = toInstance(sub, sub.dueDate, null, now);
                  const isSubToday = sub.dueDate === today;
                  const subPicked = pickedIds.includes(sub.id);
                  const {
                    onGripKeyDown,
                    className: dragClass,
                    ...dragHandlers
                  } = subtaskReorder.row(index);
                  return (
                    <div
                      key={sub.id}
                      className={cn(
                        "plan-subtask-item",
                        subDone && "done",
                        picking && "picking",
                        subPicked && "picked",
                        dragClass,
                      )}
                      {...dragHandlers}
                    >
                      {/* Two boxes on one row, doing two different jobs: the
                          left one says what happens to this step, the right one
                          says whether it is finished. The pick box only exists
                          while a selection is being made, so the row nobody is
                          selecting in looks exactly as it always did. */}
                      {picking ? (
                        <label
                          className="task-pick"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={subPicked}
                            aria-label={t("bulkSelectAria", {
                              title: sub.title,
                            })}
                            onChange={() =>
                              pick(sub.id, { listIds: stepIds })
                            }
                            onClick={(e) => {
                              if (e.shiftKey) {
                                e.preventDefault();
                                pick(sub.id, { listIds: stepIds, range: true });
                              }
                            }}
                          />
                        </label>
                      ) : null}
                      <Checkbox
                        done={subDone}
                        onToggle={() => toggleComplete(subInstance)}
                      />
                      <span
                        className="plan-subtask-label grow truncate"
                        onClick={(e) => {
                          if (pickIf(e, sub.id, stepIds)) return;
                          onOpen(subInstance);
                        }}
                        title={t("plansSubtaskOpen")}
                      >
                        {sub.title}
                      </span>
                      {isSubToday && (
                        <span
                          className="plan-subtask-today-tag"
                          title={t("plansAssignedToday")}
                        >
                          <Sun size={10} /> Bugün
                        </span>
                      )}
                      <div
                        role="button"
                        tabIndex={0}
                        className="plan-subtask-grip"
                        aria-label={t("taskReorderAria", { title: sub.title })}
                        title={t("taskReorderHint")}
                        onKeyDown={onGripKeyDown}
                      >
                        <GripVertical size={12} />
                      </div>
                      <button
                        type="button"
                        className={cn(
                          "btn ghost icon xs plan-subtask-today-btn",
                          isSubToday && "active",
                        )}
                        title={
                          isSubToday ? t("removeFromToday") : t("assignToToday")
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          updateTask(sub.id, {
                            dueDate: isSubToday ? null : today,
                            allDay: true,
                          });
                        }}
                        style={isSubToday ? { color: "#f59e0b" } : undefined}
                      >
                        <Sun size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {(hiddenSubtaskCount > 0 || showAllSubtasks) && (
              <button
                type="button"
                className="btn ghost plan-subtask-more"
                onClick={() => setShowAllSubtasks((v) => !v)}
              >
                {showAllSubtasks
                  ? t("showLess")
                  : t("moreCount", { n: hiddenSubtaskCount })}
              </button>
            )}

            {/* Quick Add Subtask inline */}
            <div className="plan-subtask-add-row">
              <input
                className="input sm grow"
                placeholder={t("plansAddSubtask")}
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSubtask();
                }}
              />
              {newSubtask.trim() && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={handleAddSubtask}
                >
                  Ekle
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The dated checkpoints a plan is broken into.
 *
 * Separate from the plan's own deadline, which says when the whole thing is
 * due, and separate from its steps, which are the work: "backend bitecek, 25
 * Eylül" is a date the project has to reach, whether or not a step is named
 * after it. See `domain/deadline` for why each one is a record of its own.
 *
 * The section keeps the shape of the steps list beside it — a header that
 * folds, rows, an add row at the bottom — so a card reads as one thing rather
 * than two lists that happen to share a border.
 */
function PlanDeadlines({ taskId, today }: { taskId: string; today: string }) {
  const { t } = useI18n();
  const deadlines = useDeadlines(taskId);
  const addDeadline = useStore((s) => s.addDeadline);
  const setDeadlineMet = useStore((s) => s.setDeadlineMet);
  const removeDeadline = useStore((s) => s.removeDeadline);

  // Open once there is something to read, folded away while there is not.
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const met = deadlines.filter((d) => d.completedAt !== null).length;

  const reset = () => {
    setAdding(false);
    setLabel("");
    setDate("");
  };

  const submit = () => {
    if (!label.trim() || !date) return;
    addDeadline({ taskId, label, date });
    // Straight back to an empty pair of fields: checkpoints arrive in batches
    // — a project is planned in one sitting, not one date a week.
    setLabel("");
    setDate("");
  };

  return (
    <div className="plan-deadlines">
      <div className="plan-deadlines-head">
        <span
          className="plan-deadlines-title"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("planDeadlinesHeading")}
          {deadlines.length > 0 && (
            <span className="plan-deadlines-count mono">
              {met}/{deadlines.length}
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn ghost plan-deadlines-add"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
            setAdding(true);
          }}
        >
          <Plus size={12} /> {t("planDeadlinesAdd")}
        </button>
      </div>

      {/* No empty state: on a plan that keeps no deadlines the header and its
          button are the whole section, which is one line rather than three. */}
      {expanded && (deadlines.length > 0 || adding) && (
        <div className="plan-deadlines-body">
          {deadlines.map((deadline) => (
            <PlanDeadlineRow
              key={deadline.id}
              deadline={deadline}
              today={today}
              onToggle={() =>
                setDeadlineMet(deadline.id, deadline.completedAt === null)
              }
              onEdit={() => setEditingId(deadline.id)}
              onRemove={() => removeDeadline(deadline.id)}
            />
          ))}

          {adding && (
            <div className="plan-deadline-add-row">
              <input
                className="input sm grow"
                autoFocus
                placeholder={t("planDeadlineLabelPlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") reset();
                }}
              />
              <input
                className="input sm plan-deadline-date-input"
                type="date"
                value={date}
                aria-label={t("formDeadline")}
                onChange={(e) => setDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") reset();
                }}
              />
              <button
                type="button"
                className="btn sm"
                disabled={!label.trim() || !date}
                onClick={submit}
              >
                {t("add")}
              </button>
              <button
                type="button"
                className="btn ghost icon sm"
                title={t("cancel")}
                aria-label={t("cancel")}
                onClick={reset}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {editingId && (
        <DeadlineEditor
          taskId={taskId}
          deadlineId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function PlanDeadlineRow({
  deadline,
  today,
  onToggle,
  onEdit,
  onRemove,
}: {
  deadline: Deadline;
  today: string;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const done = deadline.completedAt !== null;
  const missed = isMissed(deadline, today);

  return (
    <div className={cn("plan-deadline-item", done && "done", missed && "missed")}>
      {/* A flag, not a task's tick box.
          A deadline is a date the project has to reach, and the control that
          says it was reached should not be the same square that says a job is
          finished — it is the difference the whole record type exists to make.
          The flag fills in when the date is met, which is what a flag does. */}
      <button
        type="button"
        className={cn("plan-deadline-flag", done && "is-met")}
        aria-pressed={done}
        title={done ? t("planDeadlineUnmet") : t("planDeadlineMet")}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <Flag size={13} fill={done ? "currentColor" : "none"} aria-hidden />
      </button>
      {/* The checkbox beside it is the way to tick a checkpoint off, so the
          text is free to be what it reads as: the thing you click to change
          what it says and when it is due. */}
      <span
        className="plan-deadline-label grow truncate"
        title={t("planDeadlineEdit")}
        onClick={onEdit}
      >
        {deadline.label}
      </span>
      {missed && (
        <span className="plan-deadline-missed">{t("planDeadlineMissed")}</span>
      )}
      <button
        type="button"
        className="plan-deadline-date mono"
        title={t("planDeadlineEdit")}
        onClick={onEdit}
      >
        <Flag size={10} aria-hidden /> {deadline.date}
      </button>
      <button
        type="button"
        className="btn ghost icon xs plan-deadline-remove"
        title={t("planDeadlineRemove")}
        aria-label={t("planDeadlineRemove")}
        onClick={onRemove}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function NewPlanModal({
  categories,
  onClose,
  onCreate,
}: {
  categories: { id: string; name: string; color: string }[];
  onClose: () => void;
  onCreate: (
    title: string,
    description: string,
    categoryId: string | null,
    priority: Priority,
    initialSubtasks: string[],
  ) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [subtasksText, setSubtasksText] = useState("");

  const handleSubmit = () => {
    if (!title.trim()) return;
    const subs = subtasksText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    onCreate(title.trim(), description.trim(), categoryId, priority, subs);
  };

  return (
    <Modal
      title={t("plansNewTitle")}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            {t("plansStart")}
          </button>
        </>
      }
    >
      <Field label={t("plansFieldTitle")}>
        <input
          className="input"
          autoFocus
          placeholder={t("plansTitlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label={t("plansFieldWhy")}>
        <textarea
          className="input"
          rows={2}
          placeholder={t("plansWhyPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label={t("formCategory")}>
            <select
              className="select"
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">{t("plansNoCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ flex: 1 }}>
          <Field label={t("formPriority")}>
            <select
              className="select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority${p}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <Field label={t("plansFieldSteps")}>
        <textarea
          className="input"
          rows={3}
          placeholder={t("plansStepsPlaceholder")}
          value={subtasksText}
          onChange={(e) => setSubtasksText(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
