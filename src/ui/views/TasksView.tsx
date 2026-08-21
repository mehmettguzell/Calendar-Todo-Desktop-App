import { ListChecks } from "lucide-react";
import type { TaskInstance } from "@/domain/types";
import { useTodoGroups, type Filters } from "@/state/selectors";
import { Empty } from "@/ui/components/primitives";
import { TaskRow } from "@/ui/task/TaskRow";

/**
 * The Todo projection of the same rows the calendar draws, bucketed by urgency
 * rather than laid out on a grid. Completing here completes there.
 */
export function TasksView({
  filters,
  selectedKey,
  onOpen,
}: {
  filters: Filters;
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const groups = useTodoGroups(filters);

  if (groups.length === 0) {
    return (
      <div className="page">
        <Empty
          icon={<ListChecks size={28} />}
          title="No tasks match"
          hint="Clear a filter, or create your first task."
        />
      </div>
    );
  }

  return (
    <div className="page">
      {groups.map((group) => (
        <section key={group.id} className="section">
          <div className={group.id === "overdue" ? "section-head alert" : "section-head"}>
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
