import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Flame,
  FolderKanban,
  Layers,
  List,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { toInstance } from "@/domain/task";
import type { Priority, Task, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  useCategories,
  useLiveTasks,
  useTodoGroups,
  useTrashedTasks,
  type Filters,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { Empty } from "@/ui/components/primitives";
import { TrashModal } from "@/ui/components/TrashModal";
import { TaskRow } from "@/ui/task/TaskRow";

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
  const trashedTasks = useTrashedTasks();
  const createTask = useStore((s) => s.createTask);
  const categories = useCategories();
  const now = useNow();
  const today = toLocalDate(now);
  const groups = useTodoGroups(filters);
  const { t } = useI18n();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [quickTitle, setQuickTitle] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
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
          const parent = parentCache.get(t.parentId);
          return parent?.tags.includes("plan") && t.dueDate !== null;
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

  const handleQuickAdd = () => {
    const trimmed = quickTitle.trim();
    if (!trimmed) return;

    const newTask = createTask({
      title: trimmed,
      priority: "NONE",
      dueDate: today,
      allDay: true,
    });

    setQuickTitle("");
    onOpen(toInstance(newTask, today, null, now));
  };

  return (
    <div className="page wide">
      {/* Task Summary Banner */}
      <div className="task-summary-banner section">
        <div className="task-summary-stat">
          <div className="task-summary-val">{stats.open}</div>
          <div className="task-summary-lbl">{t("tasksOpen")}</div>
        </div>
        <div className="task-summary-stat">
          <div
            className="task-summary-val"
            style={{ color: stats.high > 0 ? "var(--danger)" : undefined }}
          >
            {stats.high}
          </div>
          <div className="task-summary-lbl">{t("tasksHighPriority")}</div>
        </div>
        <div className="task-summary-stat">
          <div
            className="task-summary-val"
            style={{ color: stats.overdue > 0 ? "var(--warning)" : undefined }}
          >
            {stats.overdue}
          </div>
          <div className="task-summary-lbl">{t("tasksOverdue")}</div>
        </div>
        <div className="task-summary-stat">
          <div className="task-summary-val" style={{ color: "var(--success)" }}>
            {stats.done}
          </div>
          <div className="task-summary-lbl">{t("tasksCompleted")}</div>
        </div>
      </div>

      {/* Quick Add Bar */}
      <div className="row section" style={{ gap: 8 }}>
        <input
          className="input grow"
          placeholder="Yeni bir görev ekleyin… (Örn: Raporu hazırla ve ekibe gönder)"
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickAdd();
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!quickTitle.trim()}
          onClick={handleQuickAdd}
        >
          <Plus size={14} /> Ekle
        </button>
      </div>

      {/* View Switcher & Filter Pills */}
      <div className="tasks-controls-bar section">
        <div className="tasks-filter-pills">
          <button
            type="button"
            className={cn("filter-pill", filterPill === "all" && "active")}
            onClick={() => setFilterPill("all")}
          >
            Tümü
          </button>
          <button
            type="button"
            className={cn("filter-pill", filterPill === "high" && "active")}
            onClick={() => setFilterPill("high")}
          >
            <Flame size={12} /> Yüksek Öncelikli ({stats.high})
          </button>
          {stats.overdue > 0 && (
            <button
              type="button"
              className={cn(
                "filter-pill danger",
                filterPill === "overdue" && "active",
              )}
              onClick={() => setFilterPill("overdue")}
            >
              <CircleAlert size={12} /> Gecikenler ({stats.overdue})
            </button>
          )}
          <button
            type="button"
            className={cn(
              "filter-pill",
              filterPill === "completed" && "active",
            )}
            onClick={() => setFilterPill("completed")}
          >
            <CheckCircle2 size={12} /> Tamamlananlar ({stats.done})
          </button>
        </div>

        <div className="row items-center" style={{ gap: 8 }}>
          <div className="tasks-view-switcher">
            <button
              type="button"
              className={cn("tasks-view-btn", viewMode === "list" && "active")}
              title="Liste Görünümü"
              onClick={() => setViewMode("list")}
            >
              <List size={15} /> Liste
            </button>
            <button
              type="button"
              className={cn(
                "tasks-view-btn",
                viewMode === "priority" && "active",
              )}
              title="Öncelik Panosu (Kanban)"
              onClick={() => setViewMode("priority")}
            >
              <FolderKanban size={15} /> Öncelik Panosu
            </button>
            <button
              type="button"
              className={cn(
                "tasks-view-btn",
                viewMode === "category" && "active",
              )}
              title="Kategori Matrisi"
              onClick={() => setViewMode("category")}
            >
              <Layers size={15} /> Kategoriler
            </button>
          </div>

          <button
            type="button"
            className="btn ghost sm"
            style={{ gap: 6, padding: "5px 10px", fontSize: 12 }}
            title={t("trash")}
            onClick={() => setTrashOpen(true)}
          >
            <Trash2 size={13} />
            {t("trash")}
            {trashedTasks.length > 0 && (
              <span
                className="nav-count is-alert"
                style={{ fontSize: 10, padding: "1px 5px", height: "auto" }}
              >
                {trashedTasks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}

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
  groups: { id: string; label: string; instances: TaskInstance[] }[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  filterPill: string;
  filteredTasks: Task[];
  now: Date;
}) {
  if (filterPill !== "all") {
    if (filteredTasks.length === 0) {
      return (
        <Empty
          icon={<ListChecks size={28} />}
          title="Filtreye uygun görev bulunamadı"
          hint="Farklı bir filtre seçebilir veya yeni bir görev ekleyebilirsiniz."
        />
      );
    }

    return (
      <div className="task-list">
        {filteredTasks.map((t) => {
          const instance = toInstance(t, t.dueDate, null, now);
          return (
            <TaskRow
              key={instance.key}
              instance={instance}
              selected={instance.key === selectedKey}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Empty
        icon={<ListChecks size={28} />}
        title="Görev listeniz boş"
        hint="Yukarıdaki çubuktan ilk görevinizi ekleyin ve üretkenliğin tadını çıkarın!"
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
            <h2>{group.label}</h2>
            <span className="count">{group.instances.length}</span>
          </div>
          <div className="task-list">
            {group.instances.map((instance) => (
              <TaskRow
                key={instance.key}
                instance={instance}
                selected={instance.key === selectedKey}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const PRIORITY_COLUMNS: {
  id: Priority;
  label: string;
  icon: string;
  className: string;
}[] = [
  { id: "HIGH", label: "Yüksek / Acil", icon: "🔴", className: "high" },
  { id: "MEDIUM", label: "Orta Öncelik", icon: "🟡", className: "medium" },
  { id: "LOW", label: "Düşük Öncelik", icon: "🔵", className: "low" },
  { id: "NONE", label: "Önceliksiz", icon: "⚪", className: "none" },
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
  return (
    <div className="kanban-grid">
      {PRIORITY_COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.priority === col.id);
        return (
          <div key={col.id} className={cn("kanban-column", col.className)}>
            <div className="kanban-column-head">
              <span className="kanban-col-icon">{col.icon}</span>
              <h3 className="kanban-col-title">{col.label}</h3>
              <span className="count">{colTasks.length}</span>
            </div>

            <div className="kanban-cards-list">
              {colTasks.length === 0 ? (
                <div className="kanban-empty-slot">{t("tasksNone")}</div>
              ) : (
                colTasks.map((t) => {
                  const instance = toInstance(t, t.dueDate, null, now);
                  return (
                    <TaskRow
                      key={instance.key}
                      instance={instance}
                      selected={instance.key === selectedKey}
                      onOpen={onOpen}
                    />
                  );
                })
              )}
            </div>
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
  const allColumns = [
    ...categories,
    { id: "uncategorized", name: t("budgetUncategorised"), color: "var(--border-strong)" },
  ];

  return (
    <div className="kanban-grid">
      {allColumns.map((cat) => {
        const colTasks = tasks.filter((t) =>
          cat.id === "uncategorized" ? !t.categoryId : t.categoryId === cat.id,
        );

        return (
          <div key={cat.id} className="kanban-column">
            <div className="kanban-column-head">
              <i className="dot" style={{ background: cat.color }} />
              <h3 className="kanban-col-title">{cat.name}</h3>
              <span className="count">{colTasks.length}</span>
            </div>

            <div className="kanban-cards-list">
              {colTasks.length === 0 ? (
                <div className="kanban-empty-slot">{t("tasksNone")}</div>
              ) : (
                colTasks.map((t) => {
                  const instance = toInstance(t, t.dueDate, null, now);
                  return (
                    <TaskRow
                      key={instance.key}
                      instance={instance}
                      selected={instance.key === selectedKey}
                      onOpen={onOpen}
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
