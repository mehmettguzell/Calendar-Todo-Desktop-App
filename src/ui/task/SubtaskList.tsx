import { useState } from "react";
import { ArrowUpRight, GripVertical, Plus, Trash2 } from "lucide-react";
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
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const [title, setTitle] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Where the dragged row would land: the gap *before* this index. */
  const [dropSlot, setDropSlot] = useState<number | null>(null);

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

  /** Move the row at `index` `delta` places, then hand the store the new order. */
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= subtasks.length) return;
    const ids = subtasks.map((s) => s.id);
    const [moved] = ids.splice(index, 1) as [string];
    ids.splice(target, 0, moved);
    reorderSubtasks(parent.id, ids);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropSlot(null);
  };

  const drop = () => {
    if (dragIndex === null || dropSlot === null) return endDrag();
    // A slot below the dragged row loses one place once that row is lifted out.
    const target = dropSlot > dragIndex ? dropSlot - 1 : dropSlot;
    move(dragIndex, target - dragIndex);
    endDrag();
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

      {subtasks.map((subtask, index) => (
        <div
          key={subtask.id}
          className={cn(
            "subtask-row",
            subtask.status === "COMPLETED" && "done",
            dragIndex === index && "dragging",
            dropSlot === index && "drop-before",
            dropSlot === subtasks.length && index === subtasks.length - 1 && "drop-after",
          )}
          draggable
          onDragStart={(e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = "move";
            // Firefox refuses to start a drag without payload on the transfer.
            e.dataTransfer.setData("text/plain", subtask.id);
          }}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const box = e.currentTarget.getBoundingClientRect();
            setDropSlot(e.clientY < box.top + box.height / 2 ? index : index + 1);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop();
          }}
          onDragEnd={endDrag}
        >
          <button
            type="button"
            className="subtask-grip"
            aria-label={`Reorder "${subtask.title}" — arrow up or down`}
            title="Drag to reorder (or focus and press ↑ / ↓)"
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              move(index, e.key === "ArrowUp" ? -1 : 1);
            }}
          >
            <GripVertical size={13} />
          </button>

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
          <span className="label wrap">{subtask.title}</span>
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
