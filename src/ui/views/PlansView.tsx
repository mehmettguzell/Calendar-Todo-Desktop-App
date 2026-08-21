import { useMemo, useState } from "react";
import { Target, Plus } from "lucide-react";
import type { TaskInstance } from "@/domain/types";
import { useStore, useNow } from "@/state/store";
import { useLiveTasks } from "@/state/selectors";
import { Empty } from "@/ui/components/primitives";
import { TaskRow } from "@/ui/task/TaskRow";
import { toInstance } from "@/domain/task";

type SortMethod = "priority" | "subtasks";

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
  const [title, setTitle] = useState("");
  const [sortMethod, setSortMethod] = useState<SortMethod>("priority");

  const plans = tasks.filter((t) => t.tags.includes("plan"));
  const instances = plans.map((t) => toInstance(t, null, null, now));

  const subtaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      if (t.parentId) {
        counts.set(t.parentId, (counts.get(t.parentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [tasks]);

  const sortedInstances = useMemo(() => {
    return [...instances].sort((a, b) => {
      const rank = (p: string) => ({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 })[p] ?? 0;
      const pDiff = rank(b.task.priority) - rank(a.task.priority);
      const aCount = subtaskCounts.get(a.task.id) ?? 0;
      const bCount = subtaskCounts.get(b.task.id) ?? 0;
      const sDiff = bCount - aCount;
      
      if (sortMethod === "priority") {
        return pDiff !== 0 ? pDiff : sDiff;
      } else {
        return sDiff !== 0 ? sDiff : pDiff;
      }
    });
  }, [instances, sortMethod, subtaskCounts]);

  const add = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createTask({
      title: trimmed,
      tags: ["plan"],
      dueDate: null,
      allDay: true,
    });
    setTitle("");
  };

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <Target size={16} />
        <h2>Plans</h2>
        <span className="count grow">{plans.length}</span>
        
        {plans.length > 0 && (
          <select 
            className="select" 
            style={{ width: "auto", fontSize: 13 }}
            value={sortMethod}
            onChange={(e) => setSortMethod(e.target.value as SortMethod)}
          >
            <option value="priority">Sort by Priority</option>
            <option value="subtasks">Sort by Subtasks</option>
          </select>
        )}
      </div>

      <div className="row" style={{ marginBottom: 24, gap: 8 }}>
        <input
          className="input grow"
          placeholder="New long-term plan (e.g. Get Fit)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="btn primary" onClick={add}>
          <Plus size={14} /> Create
        </button>
      </div>

      {sortedInstances.length === 0 ? (
        <Empty
          icon={<Target size={28} />}
          title="No plans yet"
          hint="Create a high-level plan here. Then click on it to add one-off or recurring subtasks to achieve it."
        />
      ) : (
        <div className="task-list">
          {sortedInstances.map((instance) => (
            <TaskRow
              key={instance.key}
              instance={instance}
              selected={instance.key === selectedKey}
              onOpen={onOpen}
              showDate={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
