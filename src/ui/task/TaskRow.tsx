import { useState, type MouseEvent } from "react";
import {
  AlarmClock,
  CalendarMinus,
  Clock,
  Flag,
  GripVertical,
  Play,
  Repeat,
  Square,
  Target,
  Timer,
  Trash2,
} from "lucide-react";
import { describeWhen, formatTracked } from "@/domain/datetime";
import type { TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  useCategoryIndex,
  useHasReminder,
  useSubtasks,
  useTrackedSeconds,
} from "@/state/selectors";
import { useSelectionStore } from "@/state/selectionStore";
import { useNow, useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";
import { Checkbox, StatusBadge } from "@/ui/components/primitives";
import type { RowReorder } from "./useListReorder";
import { SnoozeMenu } from "./SnoozeMenu";
import { useRequestDelete } from "./useRequestDelete";

/**
 * One task, as it appears in every list-shaped view.
 *
 * The row is intentionally the same component in Today, Todo, Search and Trash:
 * one task has one representation, so completing it anywhere behaves the same.
 */
export function TaskRow({
  instance,
  selected,
  onOpen,
  showDate = true,
  reorder,
  onContextMenu,
  listIds,
}: {
  instance: TaskInstance;
  selected?: boolean;
  onOpen: (instance: TaskInstance) => void;
  showDate?: boolean;
  /**
   * Supplied by a list that can be rearranged. Left out — in Trash, in search
   * results — the row has no grip and no drag behaviour at all, which is the
   * point: a task looks exactly as movable as it actually is.
   */
  reorder?: RowReorder;
  /** Right-click. Left out, the row has no menu — as in Trash and search. */
  onContextMenu?: (
    event: MouseEvent<HTMLDivElement>,
    task: TaskInstance,
  ) => void;
  /**
   * The ids of the list this row is drawn in, in the order it is drawn.
   *
   * Supplied only by lists where picking several tasks makes sense. Left out —
   * in Trash, in search results — the row cannot be selected at all, which is
   * the point: a bulk action has nowhere sensible to apply there.
   *
   * It is also what a Shift-click measures across: a range spanning two
   * different lists is not a range the user can see.
   */
  listIds?: string[];
}) {
  const { task } = instance;
  const { t } = useI18n();
  const toggleComplete = useStore((s) => s.toggleComplete);
  const updateTask = useStore((s) => s.updateTask);
  const requestDelete = useRequestDelete();
  const pushUndo = useUndoStore((s) => s.push);
  const startFocus = useStore((s) => s.startFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const runningFocus = useStore((s) => s.runningFocus);
  const tasks = useStore((s) => s.db.tasks);
  const hasReminder = useHasReminder(task.id);
  const categories = useCategoryIndex();
  const subtasks = useSubtasks(task.id);
  const tracked = useTrackedSeconds(task.id);
  const now = useNow();
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const selectionActive = useSelectionStore((s) => s.active);
  const picked = useSelectionStore((s) => s.ids.includes(task.id));
  const pick = useSelectionStore((s) => s.pick);
  /*
   * Picking stays out of sight until it is asked for.
   *
   * A modifier click is what asks for it — the gesture every file list on every
   * desktop already uses — and only then does the checkbox column appear. A
   * list nobody is selecting in looks exactly as it did before selecting
   * existed.
   */
  const selectable = listIds !== undefined;
  const picking = selectable && selectionActive;

  const onRowClick = (e: MouseEvent<HTMLElement>) => {
    if (!selectable) return false;
    if (!picking && !e.ctrlKey && !e.metaKey && !e.shiftKey) return false;
    e.preventDefault();
    e.stopPropagation();
    pick(task.id, { listIds, range: e.shiftKey });
    return true;
  };

  const parentTask = task.parentId
    ? (tasks.find((t) => t.id === task.parentId) ?? null)
    : null;

  const category = task.categoryId ? categories.get(task.categoryId) : null;
  const done = instance.storedStatus === "COMPLETED";
  const doneSubtasks = subtasks.filter((s) => s.status === "COMPLETED").length;
  const isFocused = runningFocus?.taskId === task.id;

  const time =
    !task.allDay && task.startTime
      ? task.endTime
        ? `${task.startTime} – ${task.endTime}`
        : task.startTime
      : null;

  const drag: Partial<RowReorder> = reorder ?? {};
  const { onGripKeyDown, className: dragClass, ...dragHandlers } = drag;

  return (
    <div
      className={cn(
        "task-row",
        done && "done",
        selected && "selected",
        picking && "picking",
        picked && "picked",
        dragClass,
      )}
      {...dragHandlers}
      onContextMenu={
        onContextMenu ? (event) => onContextMenu(event, instance) : undefined
      }
    >
      {picking ? (
        <label className="task-pick" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={picked}
            aria-label={t("bulkSelectAria", { title: task.title })}
            onChange={() => pick(task.id, { listIds })}
            onClick={(e) => {
              if (e.shiftKey) {
                e.preventDefault();
                pick(task.id, { listIds, range: true });
              }
            }}
          />
        </label>
      ) : null}

      <div className={cn("prio", task.priority)} aria-hidden />
      <div style={{ paddingTop: 1 }}>
        <Checkbox done={done} onToggle={() => toggleComplete(instance)} />
      </div>

      <button
        type="button"
        className="task-main"
        onClick={(e) => {
          if (onRowClick(e)) return;
          onOpen(instance);
        }}
      >
        <div className="task-title">
          <span className="label wrap">{task.title}</span>
          {instance.status === "OVERDUE" || instance.status === "SNOOZED" ? (
            <StatusBadge status={instance.status} />
          ) : null}
          {task.recurrence ? (
            <Repeat size={13} className="faint" aria-label={t("repeatsAria")} />
          ) : null}
          {hasReminder ? (
            <AlarmClock
              size={13}
              className="faint"
              aria-label={t("hasReminderAria")}
            />
          ) : null}
        </div>

        <div className="task-meta">
          {/* Only when there is one, and always in front of the schedule: the
              day a task must be done by is what a list is scanned for. */}
          {task.deadline && !task.recurrence ? (
            <span
              className={cn("row", "task-deadline", instance.status === "OVERDUE" && "is-overdue")}
              style={{ gap: 4 }}
              title={t("deadlineOn", { date: task.deadline })}
            >
              <Flag size={12} />
              {task.deadline}
            </span>
          ) : null}
          {showDate ? (
            <span className="row" style={{ gap: 4 }}>
              <Clock size={12} />
              {describeWhen(instance.date, time ? task.startTime : null, now)}
            </span>
          ) : null}
          {time ? <span className="mono">{time}</span> : null}
          {task.allDay && instance.date ? (
            <span className="tag">{t("allDay")}</span>
          ) : null}
          {category ? (
            <span className="row" style={{ gap: 5 }}>
              <i className="dot" style={{ background: category.color }} />
              {category.name}
            </span>
          ) : null}
          {parentTask ? (
            <span
              className="row"
              style={{
                gap: 4,
                color: "var(--accent)",
                fontSize: 11.5,
                fontWeight: 500,
              }}
              title={parentTask.title}
            >
              <Target size={11} />
              <span className="truncate" style={{ maxWidth: 140 }}>
                {parentTask.title}
              </span>
            </span>
          ) : null}
          {subtasks.length > 0 ? (
            <span className="subtask-strip">
              <span className="progress">
                <i
                  style={{
                    width: `${(doneSubtasks / subtasks.length) * 100}%`,
                  }}
                />
              </span>
              {doneSubtasks}/{subtasks.length}
            </span>
          ) : null}
          {tracked > 0 ? (
            <span className="row" style={{ gap: 4 }}>
              <Timer size={12} />
              {formatTracked(tracked)}
            </span>
          ) : null}
          {task.tags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
            </span>
          ))}
        </div>
      </button>

      <div className="task-actions" style={{ position: "relative" }}>
        {/* The handle sits with the other row controls rather than in front of
            the title: a list nobody is dragging has to look exactly as it did
            before it could be dragged, and the left edge is where that shows. */}
        {reorder ? (
          <div
            role="button"
            tabIndex={0}
            className="task-grip"
            aria-label={t("taskReorderAria", { title: task.title })}
            title={t("taskReorderHint")}
            onKeyDown={onGripKeyDown}
          >
            <GripVertical size={14} />
          </div>
        ) : null}
        <button
          type="button"
          className="btn ghost icon"
          title={isFocused ? t("formStopTimer") : t("formStartTimer")}
          onClick={(e) => {
            e.stopPropagation();
            isFocused ? stopFocus() : startFocus(instance);
          }}
        >
          {isFocused ? <Square size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          className="btn ghost icon"
          title={t("snooze")}
          onClick={(e) => {
            e.stopPropagation();
            setSnoozeOpen((v) => !v);
          }}
        >
          <AlarmClock size={14} />
        </button>
        {/*
          A subtask is not deleted from here — it is taken off the schedule and
          left in its plan. It does that and then offers it back, rather than
          asking first: clearing a step off today is the most repeated act in
          this list, and a modal in front of a reversible move is a toll paid on
          every one of them. The undo toast carries what the question used to —
          it names which of the two things just happened to the row that
          vanished, and hands it back in one click if it was the wrong one.
        */}
        <button
          type="button"
          className="btn ghost icon"
          title={task.parentId ? t("removeFromSchedule") : t("menuDelete")}
          onClick={(e) => {
            e.stopPropagation();
            if (!task.parentId) {
              requestDelete(task.id);
              return;
            }
            const previousDate = task.dueDate;
            updateTask(task.id, { dueDate: null });
            pushUndo("undoneRemovedFromSchedule", () =>
              updateTask(task.id, { dueDate: previousDate }),
            );
          }}
        >
          {task.parentId ? <CalendarMinus size={14} /> : <Trash2 size={14} />}
        </button>
        {snoozeOpen ? (
          <div style={{ position: "absolute", top: "100%", right: 0 }}>
            <SnoozeMenu
              instance={instance}
              align="right"
              onClose={() => setSnoozeOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
