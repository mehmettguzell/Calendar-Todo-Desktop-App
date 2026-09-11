import { toInstance } from "@/domain/task";
import { cn } from "@/lib/cn";
import {
  Checkbox,
} from "@/ui/components/primitives";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Sun,
} from "lucide-react";
import type { PlanCardModel } from "./usePlanCard";

/**
 * The plan's steps, and the box that adds one.
 *
 * Long checklists collapse behind a "+N daha" row rather than growing the card
 * or getting an inner scrollbar of their own.
 */
export function PlanSteps({ model: m }: { model: PlanCardModel }) {
  return (
    <div className="plan-subtasks-section">
      <div
        className="plan-subtasks-head"
        onClick={() => m.setExpanded((v) => !v)}
      >
        <span className="plan-subtasks-toggle-title">
          {m.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {m.t("plansStepsHeading")}
        </span>
      </div>

      {m.expanded && (
        <div className="plan-subtasks-body">
          {m.subtasks.length === 0 ? (
            <div className="faint" style={{ fontSize: "var(--text-xs)", padding: "4px 0" }}>
              {m.t("plansNoSteps")}
            </div>
          ) : (
            <div {...m.subtaskReorder.containerProps}>
              {m.visibleSubtasks.map((sub, index) => {
                const subDone = sub.status === "COMPLETED";
                const subInstance = toInstance(sub, sub.dueDate, null, m.now);
                const isSubToday = sub.dueDate === m.today;
                const subPicked = m.pickedIds.includes(sub.id);
                const {
                  onGripKeyDown,
                  className: dragClass,
                  ...dragHandlers
                } = m.subtaskReorder.row(index);
                return (
                  <div
                    key={sub.id}
                    className={cn(
                      "plan-subtask-item",
                      subDone && "done",
                      m.picking && "picking",
                      subPicked && "picked",
                      dragClass,
                    )}
                    {...dragHandlers}
                  >
                    {/* Two boxes on one row, doing two different jobs: the
                        left one says what happens to this step, the right one
                        says whether it is finished. The pick box only exists
                        while a selection is being made, so the row nobody is
                        selecting in looks exactly as it always did. */}
                    {m.picking ? (
                      <label
                        className="task-pick"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={subPicked}
                          aria-label={m.t("bulkSelectAria", {
                            title: sub.title,
                          })}
                          onChange={() => m.pick(sub.id, { listIds: m.stepIds })}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              e.preventDefault();
                              m.pick(sub.id, { listIds: m.stepIds, range: true });
                            }
                          }}
                        />
                      </label>
                    ) : null}
                    <Checkbox
                      done={subDone}
                      onToggle={() => m.toggleComplete(subInstance)}
                    />
                    <span
                      className="plan-subtask-label grow truncate"
                      onClick={(e) => {
                        if (m.pickIf(e, sub.id, m.stepIds)) return;
                        m.onOpen(subInstance);
                      }}
                      title={m.t("plansSubtaskOpen")}
                    >
                      {sub.title}
                    </span>
                    <div
                      role="button"
                      tabIndex={0}
                      className="plan-subtask-grip"
                      aria-label={m.t("taskReorderAria", { title: sub.title })}
                      title={m.t("taskReorderHint")}
                      onKeyDown={onGripKeyDown}
                    >
                      <GripVertical size={12} />
                    </div>
                    <button
                      type="button"
                      className={cn(
                        "btn ghost icon xs plan-subtask-today-btn",
                        isSubToday && "active",
                      )}
                      title={
                        isSubToday ? m.t("removeFromToday") : m.t("assignToToday")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        m.updateTask(sub.id, {
                          dueDate: isSubToday ? null : m.today,
                          allDay: true,
                        });
                      }}
                    >
                      <Sun size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {(m.hiddenSubtaskCount > 0 || m.showAllSubtasks) && (
            <button
              type="button"
              className="btn ghost plan-subtask-more"
              onClick={() => m.setShowAllSubtasks((v) => !v)}
            >
              {m.showAllSubtasks
                ? m.t("showLess")
                : m.t("moreCount", { n: m.hiddenSubtaskCount })}
            </button>
          )}

          <div className="plan-subtask-add-row">
            <input
              className="input sm grow"
              placeholder={m.t("plansAddSubtask")}
              value={m.newSubtask}
              onChange={(e) => m.setNewSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") m.handleAddSubtask();
              }}
            />
            {m.newSubtask.trim() && (
              <button
                type="button"
                className="btn sm"
                onClick={m.handleAddSubtask}
              >
                {m.t("plansAddStepButton")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
