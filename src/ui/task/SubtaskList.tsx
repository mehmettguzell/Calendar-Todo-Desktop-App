import { useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useSubtasks } from "@/state/selectors";
import { useStore } from "@/state/store";
import { Checkbox } from "@/ui/components/primitives";

/**
 * Subtasks are ordinary tasks with a `parentId`.
 *
 * That means a subtask can carry its own date, reminder and history, and it
 * shows up on the calendar like anything else. Nothing about it is a second
 * kind of record.
 */
export function SubtaskList({ parent, onOpen }: { parent: Task; onOpen: (taskId: string) => void }) {
  const subtasks = useSubtasks(parent.id);
  const createTask = useStore((s) => s.createTask);
  const setStatus = useStore((s) => s.setStatus);
  const deleteTask = useStore((s) => s.deleteTask);
  const [title, setTitle] = useState("");

  const add = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createTask({
      title: trimmed,
      parentId: parent.id,
      categoryId: parent.categoryId,
      dueDate: parent.dueDate,
      allDay: true,
    });
    setTitle("");
  };

  const done = subtasks.filter((s) => s.status === "COMPLETED").length;

  return (
    <div className="col" style={{ gap: 6 }}>
      {subtasks.length > 0 ? (
        <div className="row faint" style={{ fontSize: 11.5 }}>
          <span className="progress" style={{ width: 80 }}>
            <i style={{ width: `${(done / subtasks.length) * 100}%` }} />
          </span>
          {done} of {subtasks.length} done
        </div>
      ) : null}

      {subtasks.map((subtask) => (
        <div key={subtask.id} className={cn("subtask-row", subtask.status === "COMPLETED" && "done")}>
          <Checkbox
            square
            done={subtask.status === "COMPLETED"}
            onToggle={() =>
              setStatus(
                { taskId: subtask.id, occurrenceDate: null },
                subtask.status === "COMPLETED" ? "TODO" : "COMPLETED",
              )
            }
          />
          <span className="label truncate">{subtask.title}</span>
          <button
            type="button"
            className="btn ghost icon"
            title="Open subtask"
            onClick={() => onOpen(subtask.id)}
          >
            <ArrowUpRight size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title="Move to trash"
            onClick={() => deleteTask(subtask.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="row">
        <input
          className="input"
          placeholder="Add a subtask"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="btn icon" onClick={add} title="Add subtask">
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
