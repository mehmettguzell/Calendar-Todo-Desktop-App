import { insertAt } from "@/domain/manualOrder";
import { toInstance } from "@/domain/task";
import type { Priority, Task, TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { arrangeInstances } from "@/state/selectors";
import { useStore } from "@/state/store";
import { ResetOrderButton } from "@/ui/task/ResetOrderButton";
import { TaskList } from "@/ui/task/TaskList";

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

interface BoardProps {
  tasks: Task[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  now: Date;
}

export function PriorityKanbanView({ tasks, selectedKey, onOpen, now }: BoardProps) {
  const { t } = useI18n();
  const { updateTask, reorderTasks } = useBoardMoves();

  return (
    <div className="kanban-grid">
      {PRIORITY_COLUMNS.map((col) => {
        const instances = columnInstances(tasks, now, (task) => task.priority === col.id);
        return (
          <KanbanColumn
            key={col.id}
            listId={`priority:${col.id}`}
            className={col.className}
            marker={<i className={cn("prio-dot", col.id)} aria-hidden />}
            title={t(col.labelKey)}
            instances={instances}
            selectedKey={selectedKey}
            onOpen={onOpen}
            // Crossing a column boundary is a priority change, and it goes
            // through `updateTask` so the task's history records it as one.
            onAccept={(task, slot) => {
              updateTask(task.id, { priority: col.id });
              reorderTasks(insertAt(idsOf(instances), task.id, slot), task.id);
            }}
          />
        );
      })}
    </div>
  );
}

export function CategoryKanbanView({
  tasks,
  categories,
  selectedKey,
  onOpen,
  now,
}: BoardProps & {
  categories: { id: string; name: string; color: string }[];
}) {
  const { t } = useI18n();
  const { updateTask, reorderTasks } = useBoardMoves();
  const columns = [
    ...categories,
    {
      id: "uncategorized",
      name: t("budgetUncategorised"),
      color: "var(--border-strong)",
    },
  ];

  return (
    <div className="kanban-grid">
      {columns.map((column) => {
        const categoryId = column.id === "uncategorized" ? null : column.id;
        const instances = columnInstances(
          tasks,
          now,
          (task) => (task.categoryId ?? null) === categoryId,
        );
        return (
          <KanbanColumn
            key={column.id}
            listId={`category:${column.id}`}
            marker={<i className="dot" style={{ background: column.color }} />}
            title={column.name}
            instances={instances}
            selectedKey={selectedKey}
            onOpen={onOpen}
            onAccept={(task, slot) => {
              updateTask(task.id, { categoryId });
              reorderTasks(insertAt(idsOf(instances), task.id, slot), task.id);
            }}
          />
        );
      })}
    </div>
  );
}

/** One column of a board: a heading, and the cards that belong under it. */
function KanbanColumn({
  listId,
  className,
  marker,
  title,
  instances,
  selectedKey,
  onOpen,
  onAccept,
}: {
  listId: string;
  className?: string;
  marker: React.ReactNode;
  title: string;
  instances: TaskInstance[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  onAccept: (task: Task, slot: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className={cn("kanban-column", className)}>
      <div className="kanban-column-head">
        {marker}
        <h3 className="kanban-col-title">{title}</h3>
        <span className="count">{instances.length}</span>
        <ResetOrderButton tasks={instances.map((instance) => instance.task)} />
      </div>

      <TaskList
        listId={listId}
        className="kanban-cards-list"
        instances={instances}
        selectedKey={selectedKey}
        onOpen={onOpen}
        empty={<div className="kanban-empty-slot">{t("tasksNone")}</div>}
        onAccept={onAccept}
      />
    </div>
  );
}

function useBoardMoves() {
  return {
    updateTask: useStore((s) => s.updateTask),
    reorderTasks: useStore((s) => s.reorderTasks),
  };
}

function columnInstances(
  tasks: Task[],
  now: Date,
  belongs: (task: Task) => boolean,
): TaskInstance[] {
  return arrangeInstances(
    tasks.filter(belongs).map((task) => toInstance(task, task.dueDate, null, now)),
  );
}

const idsOf = (instances: TaskInstance[]) =>
  instances.map((instance) => instance.task.id);
