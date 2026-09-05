import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Flag,
  GripVertical,
  Lightbulb,
  MoreHorizontal,
  MousePointerClick,
  Plus,
  Sun,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { planProgress, planStage, type PlanStage } from "@/domain/plan";
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
import { Checkbox, Field, Modal, Popover } from "@/ui/components/primitives";
import { PageHeader } from "@/ui/components/PageHeader";
import { Segmented } from "@/ui/components/Segmented";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useRequestDelete } from "@/ui/task/useRequestDelete";
import { Composer } from "@/ui/task/Composer";
import { DeadlineEditor } from "@/ui/task/DeadlineEditor";

/**
 * The four answers the tabs give.
 *
 * "Aktif" used to mean "not finished", which lumped a plan someone is halfway
 * through with one they wrote down and never opened — the two things a page of
 * plans most needs to keep apart. `PlanStage` splits them, and `ALL` stays for
 * when the split is not what you are looking for.
 */
type PlanFilter = "ALL" | PlanStage;

const PLAN_TABS: { id: PlanFilter; labelKey: TranslationKey }[] = [
  { id: "ALL", labelKey: "plansAll" },
  { id: "STARTED", labelKey: "plansStarted" },
  { id: "NOT_STARTED", labelKey: "plansNotStarted" },
  { id: "COMPLETED", labelKey: "plansCompleted" },
];

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

  /**
   * Every plan with its stage worked out once.
   *
   * The tabs need the counts and the grid needs the filtered list, and both
   * used to derive "is this finished" inline — three copies of one rule that
   * could drift apart. `planStage` is now the only place that decides.
   */
  const staged = useMemo(
    () =>
      plans.map((plan) => ({
        plan,
        stage: planStage(plan, subtasksMap.get(plan.id) ?? []),
      })),
    [plans, subtasksMap],
  );

  const stageCounts = useMemo(() => {
    const counts: Record<PlanFilter, number> = {
      ALL: staged.length,
      NOT_STARTED: 0,
      STARTED: 0,
      COMPLETED: 0,
    };
    for (const row of staged) counts[row.stage] += 1;
    return counts;
  }, [staged]);

  const visiblePlans = useMemo(
    () =>
      staged
        .filter((row) => filter === "ALL" || row.stage === filter)
        .map((row) => row.plan),
    [staged, filter],
  );

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
    const stageById = new Map(staged.map((row) => [row.plan.id, row.stage]));
    for (const plan of visiblePlans) {
      const steps = subtasksMap.get(plan.id) ?? [];
      rows.push({ id: plan.id, done: stageById.get(plan.id) === "COMPLETED" });
      for (const step of steps) {
        rows.push({ id: step.id, done: step.status === "COMPLETED" });
      }
    }
    return rows;
  }, [visiblePlans, staged, subtasksMap]);

  const pickWhere = (keep: (row: { done: boolean }) => boolean) =>
    replaceSelection(pickable.filter(keep).map((row) => row.id));

  const doneCount = pickable.filter((row) => row.done).length;
  const activeCount = pickable.length - doneCount;

  const planReorder = useListReorder({
    listId: "plans:grid",
    ids: planIds,
    onReorder: reorderTasks,
  });

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
      {/* Same header as every other page. The gradient icon tile and the
          explanatory sentence that used to sit here were furniture: they said
          what the page already says by being the page.

          Counts ride on the tabs, so "how much is actually on my plate" is
          answered without pressing anything. Every tab renders even at zero —
          an empty "Başladıklarım" is itself the answer. */}
      <PageHeader
        actions={
          <>
            <button
              type="button"
              className={cn("btn ghost sm", selecting && "active")}
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
              className="btn sm"
              onClick={() => setNewPlanModal(true)}
            >
              <Plus size={14} /> {t("plansNewButton")}
            </button>
          </>
        }
        tabs={
          <Segmented
            ariaLabel={t("plansFilterAria")}
            value={filter}
            onChange={setFilter}
            segments={PLAN_TABS.map((tab) => ({
              id: tab.id,
              label: t(tab.labelKey),
              count: stageCounts[tab.id],
            }))}
          />
        }
      />

      {/* Only while selecting. What is picked is acted on from the bulk bar at
          the bottom of the window, so this row is about picking alone. */}
      {selecting ? (
        <div className="plans-pick-bar section" role="group" aria-label={t("bulkTitle")}>
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
            <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
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

      {/* The app's one add-box, seeded to make a plan rather than a task. A
          plan carries no date, so the seed clears the one the box defaults to. */}
      <div className="section">
        <Composer
          placeholder={t("plansQuickAdd")}
          submitLabel={t("plansQuickAddButton")}
          seed={{ tags: ["plan"], dueDate: null, allDay: true, priority: "MEDIUM" }}
          onCreated={(taskId) => {
            const created = useStore.getState().db.tasks.find((task) => task.id === taskId);
            if (created) onOpen(toInstance(created, null, null, now));
          }}
        />
      </div>

      {/* Starter Templates if no plans */}
      {plans.length === 0 && (
        <div className="section">
          <div className="section-head" style={{ marginBottom: 12 }}>
            <Lightbulb size={14} />
            <h2>{t("plansStarterHeading")}</h2>
            <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
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
          <p className="faint">{t("plansNoneForFilter")}</p>
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

/**
 * One plan, as a card.
 *
 * The card had grown four always-visible icon buttons, five pills and two
 * folding sections, which is a lot of furniture around what someone actually
 * looks at: the name, how far along it is, and what the next step is. So the
 * rare controls (deadline, focus, delete) moved behind one "…" and the row
 * that answers "where is this" — the stage chip — became the only thing on the
 * card you press without opening a menu.
 */
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
  const setStatus = useStore((s) => s.setStatus);
  const requestDelete = useRequestDelete();
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const categories = useCategoryIndex();

  const picking = useSelectionStore((s) => s.active);
  const pickedIds = useSelectionStore((s) => s.ids);
  const pick = useSelectionStore((s) => s.pick);

  const [expanded, setExpanded] = useState(true);
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const deadlineRef = useRef<HTMLInputElement>(null);

  /**
   * Open the native date picker for this plan.
   *
   * `showPicker` throws when the browser has no such method, or refuses
   * outside a user gesture; focusing the input is the honest fallback, since a
   * focused date input can still be typed into.
   */
  const openDeadlinePicker = () => {
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
  const planOverdue =
    plan.deadline !== null &&
    plan.deadline !== undefined &&
    plan.deadline < today;
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

  const togglePlanToday = () => {
    updateTask(plan.id, {
      dueDate: isPlanToday ? null : today,
      allDay: true,
    });
  };

  const category = plan.categoryId ? categories.get(plan.categoryId) : null;
  const stage = planStage(plan, subtasks);
  const {
    done: doneSubtasks,
    total: totalSubtasks,
    pct: progressPct,
  } = planProgress(plan, subtasks);
  const isPlanCompleted = stage === "COMPLETED";

  /**
   * Starting a plan is an ordinary status change (spec section 5), so it
   * carries its own history entry and syncs as one field. A finished plan does
   * not offer it: the answer to "have you started" is already yes.
   */
  const toggleStarted = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus(
      { taskId: plan.id, occurrenceDate: null },
      stage === "STARTED" ? "TODO" : "IN_PROGRESS",
    );
  };

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

  const runFromMenu = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    action();
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
          <h3 className="plan-card-title wrap">{plan.title}</h3>
          {totalSubtasks > 0 && (
            <span className="plan-card-count mono">
              {doneSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        {/* One door for everything that is not pressed every visit. Four icons
            competing at the top of every card is what made a wall of them hard
            to read at all. */}
        <div
          className="plan-card-menu-anchor"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="btn ghost icon sm"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("plansMoreActions")}
            title={t("plansMoreActions")}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <Popover align="right" onClose={() => setMenuOpen(false)}>
              <button
                type="button"
                className="popover-item"
                onClick={runFromMenu(togglePlanToday)}
              >
                <Sun size={14} />
                {isPlanToday ? t("removeFromToday") : t("assignToToday")}
              </button>
              <button
                type="button"
                className="popover-item"
                onClick={runFromMenu(openDeadlinePicker)}
              >
                <Flag size={14} />
                {plan.deadline
                  ? t("deadlineOn", { date: plan.deadline })
                  : t("formDeadline")}
              </button>
              <button
                type="button"
                className="popover-item"
                onClick={runFromMenu(openPlan)}
              >
                <Timer size={14} /> {t("plansFocusOn")}
              </button>
              <button
                type="button"
                className="popover-item danger"
                onClick={runFromMenu(() => requestDelete(plan.id))}
              >
                <Trash2 size={14} /> {t("plansDelete")}
              </button>
            </Popover>
          )}
          {/* Stays in the DOM: the menu item only asks the browser to open it,
              and a browser without `showPicker` needs something to focus. */}
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
        </div>
      </div>

      {plan.description && (
        <p className="plan-card-desc" onClick={activatePlan}>
          {plan.description}
        </p>
      )}

      {/* The stage chip leads, because it is the one control on the card and
          the fact the tabs above sort by. The rest of the row is context, and
          each pill is drawn only when it has something to say. */}
      <div className="plan-card-meta-row">
        {isPlanCompleted ? (
          <span className="plan-stage-chip is-completed">
            <CheckCircle2 size={12} /> {t("statusCOMPLETED")}
          </span>
        ) : (
          <button
            type="button"
            className={cn(
              "plan-stage-chip",
              stage === "STARTED" ? "is-started" : "is-not-started",
            )}
            aria-pressed={stage === "STARTED"}
            title={
              stage === "STARTED" ? t("planUnstartAction") : t("planStartAction")
            }
            onClick={toggleStarted}
          >
            {stage === "STARTED" ? (
              <>
                <CircleDot size={12} /> {t("planStageSTARTED")}
              </>
            ) : (
              <>
                <Circle size={12} /> {t("planStageNOT_STARTED")}
              </>
            )}
          </button>
        )}
        {isPlanToday && (
          <span
            className="meta-pill is-today"
            title={t("plansAddedToToday")}
          >
            <Sun size={11} /> {t("today")}
          </span>
        )}
        {category && (
          <span className="meta-item">
            <i className="dot" style={{ background: category.color }} />
            {category.name}
          </span>
        )}
        {/* Only HIGH is worth a colour. A priority tag on every card, in three
            shades, is a traffic light nobody can read; the one that means "do
            this first" should be visible from across the page. */}
        {plan.priority === "HIGH" ? (
          <span className="meta-pill is-overdue">{t("priorityHIGH")}</span>
        ) : plan.priority !== "NONE" ? (
          <span className="meta-item">{t(`priority${plan.priority}`)}</span>
        ) : null}
        {/* On the pill line rather than beside the name: a plan's title is the
            one thing that must never be the part that gets truncated. */}
        {plan.deadline && (
          <span
            className={cn("meta-item", planOverdue && "is-overdue")}
            title={t("deadlineOn", { date: plan.deadline })}
          >
            <Flag size={11} aria-hidden /> {plan.deadline}
          </span>
        )}
      </div>

      {totalSubtasks > 0 && (
        <div className="plan-progress-track" aria-hidden>
          <div
            className="plan-progress-bar"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      <PlanDeadlines taskId={plan.id} today={today} />

      <div className="plan-subtasks-section">
        <div
          className="plan-subtasks-head"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="plan-subtasks-toggle-title">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t("plansStepsHeading")}
          </span>
        </div>

        {expanded && (
          <div className="plan-subtasks-body">
            {subtasks.length === 0 ? (
              <div className="faint" style={{ fontSize: "var(--text-xs)", padding: "4px 0" }}>
                {t("plansNoSteps")}
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
                            onChange={() => pick(sub.id, { listIds: stepIds })}
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
                      >
                        <Sun size={14} />
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
                  {t("plansAddStepButton")}
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

  const empty = deadlines.length === 0 && !adding;

  return (
    <div className={cn("plan-deadlines", empty && "is-empty")}>
      <div className="plan-deadlines-head">
        {/* A heading over nothing is a heading nobody needs. Most plans keep no
            checkpoints at all, and on those the section is one quiet line
            offering to start one — not a title, a caret and a count of zero. */}
        {empty ? null : (
          <span
            className="plan-deadlines-title"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t("planDeadlinesHeading")}
            <span className="plan-deadlines-count mono">
              {met}/{deadlines.length}
            </span>
          </span>
        )}
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
