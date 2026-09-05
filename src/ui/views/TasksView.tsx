import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Plus,
  Flame,
  FolderKanban,
  Layers,
  List,
  ListChecks,
  MousePointerClick,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { insertAt } from "@/domain/manualOrder";
import { enclosingPlan, toInstance } from "@/domain/task";
import type { Priority, Task, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  arrangeInstances,
  useCategories,
  useLiveTasks,
  useTodoGroups,
  type Filters,
  type TodoGroup,
} from "@/state/selectors";
import { useSelectionStore } from "@/state/selectionStore";
import { useNow, useStore } from "@/state/store";
import { Empty } from "@/ui/components/primitives";
import { PageHeader } from "@/ui/components/PageHeader";
import { Segmented } from "@/ui/components/Segmented";
import { Composer, focusComposer } from "@/ui/task/Composer";
import { ResetOrderButton } from "@/ui/task/ResetOrderButton";
import { TaskList } from "@/ui/task/TaskList";

type ViewMode = "list" | "priority" | "category";

export function TasksView({
  filters,
  selectedKey,
  onOpen,
}: {
  filters: Filters;
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const tasks = useLiveTasks();
  const categories = useCategories();
  const now = useNow();
  const today = toLocalDate(now);
  const groups = useTodoGroups(filters);
  const { t } = useI18n();

  const selecting = useSelectionStore((s) => s.active);
  const beginSelecting = useSelectionStore((s) => s.begin);
  const clearSelection = useSelectionStore((s) => s.clear);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [filterPill, setFilterPill] = useState<
    "all" | "high" | "overdue" | "completed"
  >("all");

  const parentCache = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  // Main actionable tasks: standalone tasks, scheduled plans, and scheduled plan subtasks
  const mainTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.tags.includes("note")) return false;
        if (t.parentId) {
          // A step at any depth of a plan, once it has been given a day.
          return t.dueDate !== null && enclosingPlan(t, parentCache) !== null;
        }
        if (t.tags.includes("plan")) {
          return t.dueDate !== null;
        }
        return true;
      }),
    [tasks, parentCache],
  );

  // Filtered main tasks
  const filteredTasks = useMemo(() => {
    return mainTasks.filter((task) => {
      if (filterPill === "high" && task.priority !== "HIGH") return false;
      if (filterPill === "completed") return task.status === "COMPLETED";
      if (filterPill === "overdue") {
        return (
          task.status !== "COMPLETED" &&
          task.dueDate !== null &&
          task.dueDate < today
        );
      }
      // default "all"
      if (!filters.showCompleted && task.status === "COMPLETED") return false;
      return true;
    });
  }, [mainTasks, filterPill, today, filters.showCompleted]);

  // Overall Stats
  const stats = useMemo(() => {
    const total = mainTasks.length;
    const open = mainTasks.filter((t) => t.status !== "COMPLETED").length;
    const high = mainTasks.filter(
      (t) => t.priority === "HIGH" && t.status !== "COMPLETED",
    ).length;
    const overdue = mainTasks.filter(
      (t) =>
        t.status !== "COMPLETED" && t.dueDate !== null && t.dueDate < today,
    ).length;
    const done = mainTasks.filter((t) => t.status === "COMPLETED").length;
    return { total, open, high, overdue, done };
  }, [mainTasks, today]);

  return (
    <div className="page wide">
      {/*
        The four-figure banner and the filter pills under it were the same four
        numbers, twice — and the two could disagree, because one counted
        `mainTasks` and the other counted whatever the pill filtered to. One
        strip now, where the number and the thing it counts are the same
        control: pressing the number shows you what it counted.

        Grouping (list / priority / category) is a second, quieter strip. It
        answers a different question — *how* these are arranged, not *which* of
        them — and putting the two rows side by side in one bar is what made
        "which of these is the filter?" a question anyone had to ask.
      */}
      <PageHeader
        actions={
          <>
            {/* The one visible door into selecting. Everything else about the
                feature stays out of the way until it is opened — a Ctrl-click
                on any row does the same for anyone who already knows. */}
            <button
              type="button"
              className={cn("btn ghost sm", selecting && "active")}
              aria-pressed={selecting}
              title={t("bulkSelectHint")}
              onClick={() => (selecting ? clearSelection() : beginSelecting())}
            >
              <MousePointerClick size={13} />
              {t("bulkSelect")}
            </button>
            <Segmented
              size="sm"
              ariaLabel={t("tasksGroupBy")}
              value={viewMode}
              onChange={setViewMode}
              segments={[
                { id: "list", label: t("viewList"), icon: <List size={14} /> },
                {
                  id: "priority",
                  label: t("viewPriority"),
                  icon: <FolderKanban size={14} />,
                },
                {
                  id: "category",
                  label: t("viewCategory"),
                  icon: <Layers size={14} />,
                },
              ]}
            />
          </>
        }
        tabs={
          <Segmented
            ariaLabel={t("tasksFilterAria")}
            value={filterPill}
            onChange={setFilterPill}
            segments={[
              { id: "all", label: t("allTasks"), count: stats.open },
              {
                id: "high",
                label: t("highPriority"),
                icon: <Flame size={12} />,
                count: stats.high,
              },
              {
                id: "overdue",
                label: t("overdue"),
                icon: <CircleAlert size={12} />,
                count: stats.overdue,
                tone: "danger",
                hidden: stats.overdue === 0,
              },
              {
                id: "completed",
                label: t("completed"),
                icon: <CheckCircle2 size={12} />,
                count: stats.done,
              },
            ]}
          />
        }
      />

      <div className="section">
        <Composer placeholder={t("quickAddPlaceholder")} />
      </div>

      {/* Main View Contents */}
      {viewMode === "list" ? (
        <ListView
          groups={groups}
          selectedKey={selectedKey}
          onOpen={onOpen}
          filterPill={filterPill}
          filteredTasks={filteredTasks}
          now={now}
        />
      ) : viewMode === "priority" ? (
        <PriorityKanbanView
          tasks={filteredTasks}
          selectedKey={selectedKey}
          onOpen={onOpen}
          now={now}
        />
      ) : (
        <CategoryKanbanView
          tasks={filteredTasks}
          categories={categories}
          selectedKey={selectedKey}
          onOpen={onOpen}
          now={now}
        />
      )}
    </div>
  );
}

function ListView({
  groups,
  selectedKey,
  onOpen,
  filterPill,
  filteredTasks,
  now,
}: {
  groups: TodoGroup[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  filterPill: string;
  filteredTasks: Task[];
  now: Date;
}) {
  const { t } = useI18n();

  // The pill views are one flat list, so they get the same arrangement rule the
  // grouped view uses rather than whatever order the store happened to hold.
  const filtered = useMemo(
    () =>
      arrangeInstances(
        filteredTasks.map((task) => toInstance(task, task.dueDate, null, now)),
      ),
    [filteredTasks, now],
  );

  if (filterPill !== "all") {
    if (filtered.length === 0) {
      return (
        <Empty
          icon={<ListChecks size={28} />}
          title={t("tasksNoMatchTitle")}
          hint={t("tasksNoMatchHint")}
        />
      );
    }

    return (
      <TaskList
        listId={`filter:${filterPill}`}
        instances={filtered}
        selectedKey={selectedKey}
        onOpen={onOpen}
      />
    );
  }

  if (groups.length === 0) {
    return (
      <Empty
        icon={<ListChecks size={28} />}
        title={t("tasksEmptyTitle")}
        hint={t("tasksEmptyHint")}
        action={
          <button
            type="button"
            className="btn primary"
            onClick={() => focusComposer()}
          >
            <Plus size={14} /> {t("emptyAddFirstTask")}
          </button>
        }
      />
    );
  }

  return (
    <div className="tasks-groups-container">
      {groups.map((group) => (
        <section key={group.id} className="section">
          <div
            className={
              group.id === "overdue" ? "section-head alert" : "section-head"
            }
          >
            <h2>{t(group.labelKey as TranslationKey)}</h2>
            <span className="count">{group.instances.length}</span>
            <ResetOrderButton
              tasks={group.instances.map((instance) => instance.task)}
            />
          </div>
          <TaskList
            listId={`group:${group.id}`}
            instances={group.instances}
            selectedKey={selectedKey}
            onOpen={onOpen}
          />
        </section>
      ))}
    </div>
  );
}

const PRIORITY_COLUMNS: {
  id: Priority;
  labelKey: TranslationKey;
  className: string;
}[] = [
  // A dot from the palette rather than an emoji: 🔴🟡🔵⚪ renders in whatever
  // four colours the operating system happens to ship, none of which are this
  // app's, and none of which change with the theme.
  { id: "HIGH", labelKey: "kanbanHigh", className: "high" },
  { id: "MEDIUM", labelKey: "kanbanMedium", className: "medium" },
  { id: "LOW", labelKey: "kanbanLow", className: "low" },
  { id: "NONE", labelKey: "kanbanNone", className: "none" },
];

function PriorityKanbanView({
  tasks,
  selectedKey,
  onOpen,
  now,
}: {
  tasks: Task[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  now: Date;
}) {
  const { t } = useI18n();
  const updateTask = useStore((s) => s.updateTask);
  const reorderTasks = useStore((s) => s.reorderTasks);

  return (
    <div className="kanban-grid">
      {PRIORITY_COLUMNS.map((col) => {
        const instances = arrangeInstances(
          tasks
            .filter((task) => task.priority === col.id)
            .map((task) => toInstance(task, task.dueDate, null, now)),
        );
        const ids = instances.map((instance) => instance.task.id);

        return (
          <div key={col.id} className={cn("kanban-column", col.className)}>
            <div className="kanban-column-head">
              <i className={cn("prio-dot", col.id)} aria-hidden />
              <h3 className="kanban-col-title">{t(col.labelKey)}</h3>
              <span className="count">{instances.length}</span>
              <ResetOrderButton
                tasks={instances.map((instance) => instance.task)}
              />
            </div>

            <TaskList
              listId={`priority:${col.id}`}
              className="kanban-cards-list"
              instances={instances}
              selectedKey={selectedKey}
              onOpen={onOpen}
              empty={<div className="kanban-empty-slot">{t("tasksNone")}</div>}
              // Crossing a column boundary is a priority change, and it goes
              // through `updateTask` so the task's history records it as one.
              onAccept={(task, slot) => {
                updateTask(task.id, { priority: col.id });
                reorderTasks(insertAt(ids, task.id, slot), task.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function CategoryKanbanView({
  tasks,
  categories,
  selectedKey,
  onOpen,
  now,
}: {
  tasks: Task[];
  categories: { id: string; name: string; color: string }[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  now: Date;
}) {
  const { t } = useI18n();
  const updateTask = useStore((s) => s.updateTask);
  const reorderTasks = useStore((s) => s.reorderTasks);

  const allColumns = [
    ...categories,
    { id: "uncategorized", name: t("budgetUncategorised"), color: "var(--border-strong)" },
  ];

  return (
    <div className="kanban-grid">
      {allColumns.map((cat) => {
        const categoryId = cat.id === "uncategorized" ? null : cat.id;
        const instances = arrangeInstances(
          tasks
            .filter((task) => (task.categoryId ?? null) === categoryId)
            .map((task) => toInstance(task, task.dueDate, null, now)),
        );
        const ids = instances.map((instance) => instance.task.id);

        return (
          <div key={cat.id} className="kanban-column">
            <div className="kanban-column-head">
              <i className="dot" style={{ background: cat.color }} />
              <h3 className="kanban-col-title">{cat.name}</h3>
              <span className="count">{instances.length}</span>
              <ResetOrderButton
                tasks={instances.map((instance) => instance.task)}
              />
            </div>

            <TaskList
              listId={`category:${cat.id}`}
              className="kanban-cards-list"
              instances={instances}
              selectedKey={selectedKey}
              onOpen={onOpen}
              empty={<div className="kanban-empty-slot">{t("tasksNone")}</div>}
              onAccept={(task, slot) => {
                updateTask(task.id, { categoryId });
                reorderTasks(insertAt(ids, task.id, slot), task.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
