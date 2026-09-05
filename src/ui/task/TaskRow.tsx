import { useState, type MouseEvent } from "react";
import {
  AlarmClock,
  CalendarMinus,
  Flag,
  GripVertical,
  MoreHorizontal,
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
import { Checkbox, Popover, StatusBadge } from "@/ui/components/primitives";
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
  const [menuOpen, setMenuOpen] = useState(false);

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
  const isLate = instance.status === "OVERDUE";

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
        "row-hover",
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
          {/* Snoozed is a state you cannot see any other way, so it keeps its
              badge. Overdue lost one: the date below is already red, and a red
              badge beside a red date is the same alarm rung twice. */}
          {instance.status === "SNOOZED" ? (
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

        {/* Meta is text, not chrome.
            This line carried up to eight bordered pills — a rounded outline
            around every fact a task happens to have. One shape was right; the
            border was not. Five outlined chips under a title are no quieter
            than the eight different shapes they replaced, and none of them is
            the thing being read.

            So it reads as a sentence, separated by middots, in the faint
            colour. The only fact that gets a shape of its own is the one that
            changes what you would do next: a deadline already missed. */}
        <div className="task-meta">
          {showDate || time ? (
            <span className={cn("meta-item", isLate && "is-overdue")}>
              {showDate
                ? describeWhen(instance.date, time ? task.startTime : null, now)
                : null}
              {time && !showDate ? time : null}
            </span>
          ) : null}

          {/* Always in front of the rest: the day a task must be done by is
              what a list is scanned for. */}
          {task.deadline && !task.recurrence ? (
            isLate ? (
              <span
                className="meta-pill is-overdue"
                title={t("deadlineOn", { date: task.deadline })}
              >
                <Flag size={11} aria-hidden />
                {task.deadline}
              </span>
            ) : (
              <span
                className="meta-item"
                title={t("deadlineOn", { date: task.deadline })}
              >
                <Flag size={11} aria-hidden />
                {task.deadline}
              </span>
            )
          ) : null}

          {category ? (
            <span className="meta-item">
              <i className="dot" style={{ background: category.color }} />
              {category.name}
            </span>
          ) : null}

          {parentTask ? (
            <span className="meta-item" title={parentTask.title}>
              <Target size={11} aria-hidden />
              <span className="truncate" style={{ maxWidth: 150 }}>
                {parentTask.title}
              </span>
            </span>
          ) : null}

          {subtasks.length > 0 ? (
            <span className="meta-item mono">
              {doneSubtasks}/{subtasks.length}
            </span>
          ) : null}

          {tracked > 0 ? (
            <span className="meta-item">
              <Timer size={11} aria-hidden />
              {formatTracked(tracked)}
            </span>
          ) : null}

          {task.tags.map((tag) => (
            <span key={tag} className="meta-item">
              #{tag}
            </span>
          ))}
        </div>
      </button>

      {/* Three buttons on every row is 120 buttons in a list of forty, none of
          them the thing being read. They arrive with the pointer instead — and
          with the keyboard, through focus-within — and the two pressed least
          often moved one step further, behind the "…". The container keeps its
          width either way, so nothing shifts under the cursor on hover.

          The timer stays out in front: starting one is the only action here
          that is about *this minute*, and hunting for it in a menu is the
          difference between tracking time and not bothering. */}
      <div
        className={cn("task-actions hover-actions", menuOpen && "is-open")}
        style={{ position: "relative" }}
      >
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
          className={cn("btn ghost icon sm", isFocused && "active")}
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
          className="btn ghost icon sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("rowMoreActions")}
          title={t("rowMoreActions")}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen ? (
          <Popover align="right" onClose={() => setMenuOpen(false)}>
            <button
              type="button"
              className="popover-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setSnoozeOpen(true);
              }}
            >
              <AlarmClock size={14} /> {t("snooze")}
            </button>
            {/*
              A subtask is not deleted from here — it is taken off the schedule
              and left in its plan. It does that and then offers it back, rather
              than asking first: clearing a step off today is the most repeated
              act in this list, and a modal in front of a reversible move is a
              toll paid on every one of them. The undo toast carries what the
              question used to — it names which of the two things just happened
              to the row that vanished, and hands it back in one click.
            */}
            <button
              type="button"
              className="popover-item danger"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
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
              {task.parentId ? (
                <>
                  <CalendarMinus size={14} /> {t("removeFromSchedule")}
                </>
              ) : (
                <>
                  <Trash2 size={14} /> {t("menuDelete")}
                </>
              )}
            </button>
          </Popover>
        ) : null}
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
