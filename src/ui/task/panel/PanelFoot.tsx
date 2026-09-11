import {
  CalendarMinus,
  CornerDownRight,
  MoreHorizontal,
  StickyNote,
  Target,
  Trash2,
  Unlink,
} from "lucide-react";
import {
  localeTag,
} from "@/domain/datetime";
import {
  Popover,
} from "@/ui/components/primitives";
import type { TaskPanelModel } from "./useTaskPanel";

/** The actions: focus, plans, snooze, and everything behind the more menu. */
export function PanelFoot({ model: m }: { model: TaskPanelModel }) {
  return (
    <div className="panel-foot">
      <div className="panel-foot-actions">
        {/* Everything a task's relationship to the plans can be, behind one
            button. It used to be a right-click menu on the row, which is a
            gesture nobody finds, and a separate button that could only ever
            make a plan — never file the task into one. */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={m.planMenuOpen}
            onClick={() => m.setPlanMenuOpen((v) => !v)}
          >
            <Target size={14} />
            <span className="truncate" style={{ maxWidth: 140 }}>
              {m.parentTask ? m.parentTask.title : m.t("moveToPlans")}
            </span>
          </button>
          {m.planMenuOpen ? (
            <div className="popover-up">
              <Popover onClose={() => m.setPlanMenuOpen(false)} align="left">
                {m.isPlan ? (
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      m.updateTask(m.task.id, {
                        tags: m.task.tags.filter((tag) => tag !== "plan"),
                      });
                      m.setPlanMenuOpen(false);
                    }}
                  >
                    <Unlink size={14} /> {m.t("removeFromPlans")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      m.makePlan(m.task.id);
                      m.setPlanMenuOpen(false);
                    }}
                  >
                    <Target size={14} /> {m.t("menuMakePlan")}
                  </button>
                )}

                {m.openPlans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      m.setParent(m.task.id, plan.id);
                      m.setPlanMenuOpen(false);
                    }}
                  >
                    <CornerDownRight size={14} />
                    <span className="truncate">{plan.title}</span>
                  </button>
                ))}

                {m.parentTask ? (
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      m.setParent(m.task.id, null);
                      m.setPlanMenuOpen(false);
                    }}
                  >
                    <Unlink size={14} /> {m.t("detachFromParent", { title: m.parentTask.title })}
                  </button>
                ) : null}
              </Popover>
            </div>
          ) : null}
        </div>

        {/* Four buttons stood along the bottom of a 400px panel, three of
            them for things done to a task perhaps once in its life. They are
            one press away now, in the same "…" the rows and the plan cards
            use, so the foot of the panel says the one thing worth saying at a
            glance: which plan this belongs to. */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="btn ghost sm"
            aria-haspopup="menu"
            aria-expanded={m.moreMenuOpen}
            aria-label={m.t("rowMoreActions")}
            title={m.t("rowMoreActions")}
            onClick={() => m.setMoreMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={15} />
          </button>
          {m.moreMenuOpen ? (
            <div className="popover-up">
              <Popover onClose={() => m.setMoreMenuOpen(false)} align="right">
                {m.parentTask && (m.task.dueDate || m.instance.date) ? (
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      m.setMoreMenuOpen(false);
                      m.updateTask(m.task.id, { dueDate: null });
                      m.onClose();
                    }}
                  >
                    <CalendarMinus size={14} />
                    {m.t("removeFromTodayShort")}
                  </button>
                ) : null}

                {/* The mirror of the note panel's "turn into a task".
                    Disabled rather than hidden when the task has subtasks, so
                    the answer to "why can I not do this here" is on the
                    control itself. */}
                <button
                  type="button"
                  className="popover-item"
                  disabled={m.subtasks.length > 0}
                  title={
                    m.subtasks.length > 0
                      ? m.t("taskToNoteBlocked")
                      : m.t("taskToNoteHint")
                  }
                  onClick={() => {
                    m.setMoreMenuOpen(false);
                    if (m.convertToNote(m.task.id)) m.onClose();
                  }}
                >
                  <StickyNote size={14} /> {m.t("taskToNote")}
                </button>

                {/* Named for what it does — moving to the trash — rather
                    than for where the task ends up, so it does not read as a
                    link to the trash view. */}
                <button
                  type="button"
                  className="popover-item danger"
                  onClick={() => {
                    m.setMoreMenuOpen(false);
                    if (m.requestDelete(m.task.id)) m.onClose();
                  }}
                >
                  <Trash2 size={14} /> {m.t("menuDelete")}
                </button>
              </Popover>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel-foot-meta">
        <span className="faint" style={{ fontSize: "var(--text-2xs)" }}>
          {m.t("createdOn", {
            date: new Date(m.task.createdAt).toLocaleDateString(localeTag()),
          })}
        </span>
      </div>
    </div>
  );
}
