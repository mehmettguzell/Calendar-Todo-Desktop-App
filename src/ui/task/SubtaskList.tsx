import { useState, useRef } from "react";
import { ArrowUpRight, GripVertical, Plus, Trash2 } from "lucide-react";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useSubtasks } from "@/state/selectors";
import { useStore } from "@/state/store";
import { Checkbox } from "@/ui/components/primitives";
import { useRequestDelete } from "./useRequestDelete";

/**
 * Subtasks are ordinary tasks with a `parentId`.
 *
 * That means a subtask can carry its own date, reminder and history, and it
 * shows up on the calendar like anything else. Nothing about it is a second
 * kind of record.
 */
export function SubtaskList({
  parent,
  onOpen,
}: {
  parent: Task;
  onOpen: (taskId: string) => void;
}) {
  const subtasks = useSubtasks(parent.id);
  const createTask = useStore((s) => s.createTask);
  const setStatus = useStore((s) => s.setStatus);
  const requestDelete = useRequestDelete();
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  /** Where the dragged row would land: the gap *before* this index. */
  const [dropSlot, setDropSlot] = useState<number | null>(null);

  const add = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createTask({
      title: trimmed,
      parentId: parent.id,
      categoryId: parent.categoryId,
      dueDate: null,
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
    dragIndexRef.current = null;
    setDropSlot(null);
  };

  const drop = () => {
    const currentIndex = dragIndexRef.current;
    if (currentIndex === null || dropSlot === null) return endDrag();
    // A slot below the dragged row loses one place once that row is lifted out.
    const target = dropSlot > currentIndex ? dropSlot - 1 : dropSlot;
    move(currentIndex, target - currentIndex);
    endDrag();
  };

  const done = subtasks.filter((s) => s.status === "COMPLETED").length;

  return (
    <div
      className="col"
      style={{ gap: 6 }}
      onDragEnter={(e) => {
        if (dragIndexRef.current !== null) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragOver={(e) => {
        if (dragIndexRef.current !== null) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (dragIndexRef.current !== null) {
          e.preventDefault();
          e.stopPropagation();
          drop();
        }
      }}
    >
      {subtasks.length > 0 ? (
        <div className="row faint" style={{ fontSize: 11.5 }}>
          <span className="progress" style={{ width: 80 }}>
            <i style={{ width: `${(done / subtasks.length) * 100}%` }} />
          </span>
          {t("subtaskProgress", { done, total: subtasks.length })}
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
            dropSlot === subtasks.length &&
              index === subtasks.length - 1 &&
              "drop-after",
          )}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            setDragIndex(index);
            dragIndexRef.current = index;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", subtask.id);
          }}
          onDragEnter={(e) => {
            if (dragIndexRef.current !== null) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDragOver={(e) => {
            if (dragIndexRef.current === null) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            const box = e.currentTarget.getBoundingClientRect();
            setDropSlot(
              e.clientY < box.top + box.height / 2 ? index : index + 1,
            );
          }}
          onDrop={(e) => {
            e.stopPropagation();
            if (dragIndexRef.current !== null) {
              e.preventDefault();
              drop();
            }
          }}
          onDragEnd={(e) => {
            e.stopPropagation();
            endDrag();
          }}
        >
          <div
            role="button"
            tabIndex={0}
            className="subtask-grip"
            aria-label={t("subtaskReorderAria", { title: subtask.title })}
            title={t("subtaskReorderHint")}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              move(index, e.key === "ArrowUp" ? -1 : 1);
            }}
          >
            <GripVertical size={13} />
          </div>

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
            title={t("subtaskOpen")}
            onClick={() => onOpen(subtask.id)}
          >
            <ArrowUpRight size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title={t("menuDelete")}
            onClick={() => requestDelete(subtask.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="row">
        <input
          className="input"
          placeholder={t("subtaskPlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button
          type="button"
          className="btn icon"
          onClick={add}
          title={t("subtaskAdd")}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
