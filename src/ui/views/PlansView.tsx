import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Lightbulb,
  Plus,
  Sun,
  Target,
  Timer,
  Trash2,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { PRIORITIES, type Priority, type Task, type TaskInstance } from "@/domain/types";
import { toInstance } from "@/domain/task";
import {
  useCategories,
  useCategoryIndex,
  useLiveTasks,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { useListReorder } from "@/ui/task/useListReorder";
import { Checkbox, Field, Modal } from "@/ui/components/primitives";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";

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
  const now = useNow();
  const { t } = useI18n();
  const categories = useCategories();

  const [filter, setFilter] = useState<PlanFilter>("ALL");
  const [newPlanModal, setNewPlanModal] = useState(false);
  const [inlineTitle, setInlineTitle] = useState("");

  const plans = useMemo(
    () => tasks.filter((t) => t.tags.includes("plan") && !t.parentId),
    [tasks],
  );

  const subtasksMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parentId) {
        const list = map.get(t.parentId);
        if (list) list.push(t);
        else map.set(t.parentId, [t]);
      }
    }
    // By `order`, like `useSubtasks` — otherwise a card and the task panel
    // would show one plan's steps in two different orders.
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
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
    const cat = categories.find(
      (c) =>
        (
          STARTER_CATEGORY_NAMES[starter.categoryKey] as readonly string[]
        ).some((name) => name.toLowerCase() === c.name.toLowerCase()),
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

          <button
            type="button"
            className="btn primary"
            onClick={() => setNewPlanModal(true)}
          >
            <Plus size={14} /> {t("plansNewButton")}
          </button>
        </div>
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
        <div className="plans-grid">
          {visiblePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              subtasks={subtasksMap.get(plan.id) ?? []}
              selected={plan.id === selectedKey}
              onOpen={onOpen}
              now={now}
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
  onOpen,
  now,
}: {
  plan: Task;
  subtasks: Task[];
  selected: boolean;
  onOpen: (instance: TaskInstance) => void;
  now: Date;
}) {
  const { t } = useI18n();
  const toggleComplete = useStore((s) => s.toggleComplete);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const categories = useCategoryIndex();

  const [expanded, setExpanded] = useState(true);
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const today = toLocalDate(now);
  const isPlanToday = plan.dueDate === today;
  const openPlan = () => onOpen(toInstance(plan, null, null, now));

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
  const reorder = useListReorder({
    listId: `plan:${plan.id}`,
    ids: subtasks.map((sub) => sub.id),
    onReorder: (orderedIds) => reorderSubtasks(plan.id, orderedIds),
  });

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
      )}
    >
      {/* Plan Card Head */}
      <div className="plan-card-head">
        <div className="plan-card-title-row" onClick={openPlan}>
          <Target
            size={18}
            className={cn(
              "plan-icon",
              isPlanCompleted ? "completed" : "active",
            )}
          />
          <h3 className="plan-card-title truncate">{plan.title}</h3>
          {totalSubtasks > 0 && (
            <span className="plan-card-count mono">
              {doneSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        <div className="plan-card-actions">
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
              deleteTask(plan.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Plan Description & Meta */}
      {plan.description && (
        <p className="plan-card-desc" onClick={openPlan}>
          {plan.description}
        </p>
      )}

      <div className="plan-card-meta-row" onClick={openPlan}>
        {isPlanToday && (
          <span className="plan-today-pill" title={t("plansAddedToToday")}>
            <Sun size={11} /> Bugün
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
        {isPlanCompleted && (
          <span className="plan-status-pill success">
            <CheckCircle2 size={11} /> Tamamlandı
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
              <div {...reorder.containerProps}>
                {visibleSubtasks.map((sub, index) => {
                const subDone = sub.status === "COMPLETED";
                const subInstance = toInstance(sub, sub.dueDate, null, now);
                const isSubToday = sub.dueDate === today;
                const {
                  onGripKeyDown,
                  className: dragClass,
                  ...dragHandlers
                } = reorder.row(index);
                return (
                  <div
                    key={sub.id}
                    className={cn("plan-subtask-item", subDone && "done", dragClass)}
                    {...dragHandlers}
                  >
                    <Checkbox
                      done={subDone}
                      onToggle={() => toggleComplete(subInstance)}
                    />
                    <span
                      className="plan-subtask-label grow truncate"
                      onClick={() => onOpen(subInstance)}
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
                      title={isSubToday ? t("removeFromToday") : t("assignToToday")}
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
