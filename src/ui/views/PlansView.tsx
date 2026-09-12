import {
  useMemo,
  useState,
} from "react";
import {
  CheckCircle2,
  Lightbulb,
  Plus,
  X,
} from "lucide-react";
import {
  planStage,
} from "@/domain/plan";
import { arrangePinned, pinOf } from "@/domain/manualOrder";
import {
  type Task,
  type TaskInstance,
} from "@/domain/types";
import { toInstance } from "@/domain/task";
import {
  compareSteps,
  useCategories,
  useLiveTasks,
} from "@/state/selectors";
import { useSelectionStore } from "@/state/selectionStore";
import { useViewPrefs, type PlanFilter } from "@/state/viewPrefsStore";
import { useNow, useStore } from "@/state/store";
import {
  useListReorder,
} from "@/ui/task/useListReorder";
import { ResetOrderButton } from "@/ui/task/ResetOrderButton";
import { PageHeader } from "@/ui/components/PageHeader";
import { Segmented } from "@/ui/components/Segmented";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { Composer } from "@/ui/task/Composer";
import { NewPlanModal } from "./plans/NewPlanModal";
import { PlanCard } from "./plans/PlanCard";
import {
  PLAN_STARTERS,
  STARTER_CATEGORY_NAMES,
  type PlanStarter,
} from "./plans/starters";

/**
 * The four answers the tabs give.
 *
 * "Aktif" used to mean "not finished", which lumped a plan someone is halfway
 * through with one they wrote down and never opened — the two things a page of
 * plans most needs to keep apart. `PlanStage` splits them, and `ALL` stays for
 * when the split is not what you are looking for.
 *
 * `ALL` is every plan you still have, which is not every plan you have ever
 * had: a finished one is not work, and it has a tab of its own two steps to
 * the right. Left in, it grew without bound — the tab you reach for to stop
 * sorting by hand was the one that made the most to sort through.
 *
 * Which one is chosen lives in `viewPrefsStore`, not in this component: a view
 * unmounts when you click another one in the sidebar, and a filter that resets
 * every time you glance at Today is the app undoing a choice you just made.
 *
 * Started leads the strip, because it is the tab somebody opening this page is
 * already looking for. `ALL` used to lead, so every visit began by putting the
 * plans in progress back among the ones written down months ago and never
 * opened — the reader doing by eye the one job the tabs exist to do. It keeps
 * its place one step to the right of the two stages, where it reads as the way
 * *out* of the split rather than the way in.
 */
const PLAN_TABS: { id: PlanFilter; labelKey: TranslationKey }[] = [
  { id: "STARTED", labelKey: "plansStarted" },
  { id: "NOT_STARTED", labelKey: "plansNotStarted" },
  { id: "ALL", labelKey: "plansAll" },
  { id: "COMPLETED", labelKey: "plansCompleted" },
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
  const clearSelection = useSelectionStore((s) => s.clear);
  const replaceSelection = useSelectionStore((s) => s.replace);

  const filter = useViewPrefs((s) => s.planFilter);
  const setFilter = useViewPrefs((s) => s.setPlanFilter);
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
      ALL: 0,
      NOT_STARTED: 0,
      STARTED: 0,
      COMPLETED: 0,
    };
    for (const row of staged) counts[row.stage] += 1;
    // The tab counts what its tab shows, or the number is a promise the list
    // underneath does not keep.
    counts.ALL = counts.NOT_STARTED + counts.STARTED;
    return counts;
  }, [staged]);

  const visiblePlans = useMemo(
    () =>
      staged
        .filter((row) =>
          filter === "ALL" ? row.stage !== "COMPLETED" : row.stage === filter,
        )
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

