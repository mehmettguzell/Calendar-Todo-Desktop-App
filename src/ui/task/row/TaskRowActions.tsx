import {
  AlarmClock,
  CalendarMinus,
  GripVertical,
  MoreHorizontal,
  Pause,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Popover,
} from "@/ui/components/primitives";
import { SnoozeMenu } from "../SnoozeMenu";
import type { TaskRowModel } from "./useTaskRow";

/**
 * What can be done to the row, behind as few controls as possible.
 *
 * Three buttons on every row is 120 buttons in a list of forty, none of them the
 * thing being read — so they arrive with the pointer, and the two pressed least
 * often sit behind the "…". The timer stays out in front: starting one is the
 * only action here that is about *this minute*.
 */
/* eslint-disable-next-line complexity -- a flat list of optional items, not branching logic */
export function TaskRowActions({ model: m }: { model: TaskRowModel }) {
  return (
    <>
    {/* Three buttons on every row is 120 buttons in a list of forty, none of
        them the thing being read. They arrive with the pointer instead — and
        with the keyboard, through focus-within — and the two pressed least
        often moved one step further, behind the "…". The container keeps its
        width either way, so nothing shifts under the cursor on hover.

        The timer stays out in front: starting one is the only action here
        that is about *this minute*, and hunting for it in a menu is the
        difference between tracking time and not bothering. */}
    <div
      className={cn("task-actions hover-actions", m.menuOpen && "is-open")}
      style={{ position: "relative" }}
    >
      {/* The handle sits with the other row controls rather than in front of
          the title: a list nobody is dragging has to look exactly as it did
          before it could be dragged, and the left edge is where that shows. */}
      {m.reorder ? (
        <div
          role="button"
          tabIndex={0}
          className="task-grip"
          aria-label={m.t("taskReorderAria", { title: m.task.title })}
          title={m.t("taskReorderHint")}
          onKeyDown={m.onGripKeyDown}
        >
          <GripVertical size={14} />
        </div>
      ) : null}
      {/* One button while nothing is running, two on the row that is: a
          timer you cannot stop without leaving the screen you started it on
          is a timer that gets left running, and one you can only stop is a
          timer that gets stopped when you meant to step away for a minute.
          Only ever one row in the app wears the pair. */}
      <button
        type="button"
        className={cn("btn ghost icon sm", m.isFocused && !m.isPaused && "active")}
        title={
          m.isPaused
            ? m.t("resume")
            : m.isFocused
              ? m.t("pause")
              : m.t("formStartTimer")
        }
        onClick={(e) => {
          e.stopPropagation();
          if (!m.isFocused) m.startFocus(m.instance);
          else if (m.isPaused) m.resumeFocus();
          else m.pauseFocus();
        }}
      >
        {m.isFocused && !m.isPaused ? <Pause size={14} /> : <Play size={14} />}
      </button>
      {m.isFocused ? (
        <button
          type="button"
          className="btn ghost icon sm"
          title={m.t("formStopTimer")}
          onClick={(e) => {
            e.stopPropagation();
            m.stopFocus();
          }}
        >
          <Square size={14} />
        </button>
      ) : null}
      <button
        type="button"
        className="btn ghost icon sm"
        aria-haspopup="menu"
        aria-expanded={m.menuOpen}
        aria-label={m.t("rowMoreActions")}
        title={m.t("rowMoreActions")}
        onClick={(e) => {
          e.stopPropagation();
          m.setMenuOpen((v) => !v);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {m.menuOpen ? (
        <Popover align="right" onClose={() => m.setMenuOpen(false)}>
          <button
            type="button"
            className="popover-item"
            onClick={(e) => {
              e.stopPropagation();
              m.setMenuOpen(false);
              m.setSnoozeOpen(true);
            }}
          >
            <AlarmClock size={14} /> {m.t("snooze")}
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
              m.setMenuOpen(false);
              if (!m.task.parentId) {
                m.requestDelete(m.task.id);
                return;
              }
              const previousDate = m.task.dueDate;
              m.updateTask(m.task.id, { dueDate: null });
              m.pushUndo("undoneRemovedFromSchedule", () =>
                m.updateTask(m.task.id, { dueDate: previousDate }),
              );
            }}
          >
            {m.task.parentId ? (
              <>
                <CalendarMinus size={14} /> {m.t("removeFromSchedule")}
              </>
            ) : (
              <>
                <Trash2 size={14} /> {m.t("menuDelete")}
              </>
            )}
          </button>
        </Popover>
      ) : null}
      {m.snoozeOpen ? (
        <div style={{ position: "absolute", top: "100%", right: 0 }}>
          <SnoozeMenu
            instance={m.instance}
            align="right"
            onClose={() => m.setSnoozeOpen(false)}
          />
        </div>
      ) : null}
    </div>
    </>
  );
}
