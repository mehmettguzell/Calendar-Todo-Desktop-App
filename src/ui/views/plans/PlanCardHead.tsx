import {
  Popover,
} from "@/ui/components/primitives";
import {
  Flag,
  GripVertical,
  MoreHorizontal,
  Sun,
  Timer,
  Trash2,
} from "lucide-react";
import type { PlanCardModel } from "./usePlanCard";

/**
 * The title row and the one menu behind it.
 *
 * Four icons competing at the top of every card is what made a wall of them hard
 * to read at all, so everything not pressed every visit lives behind one door.
 */
export function PlanCardHead({ model: m }: { model: PlanCardModel }) {
  return (
    <div className="plan-card-head">
      <div className="plan-card-title-row" onClick={m.activatePlan}>
        {m.picking ? (
          <label className="task-pick" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={m.planPicked}
              aria-label={m.t("bulkSelectAria", { title: m.plan.title })}
              onChange={() => m.pick(m.plan.id, { listIds: m.planIds })}
              onClick={(e) => {
                if (e.shiftKey) {
                  e.preventDefault();
                  m.pick(m.plan.id, { listIds: m.planIds, range: true });
                }
              }}
            />
          </label>
        ) : null}
        {m.reorder && (
          <div
            role="button"
            tabIndex={0}
            className="plan-card-grip"
            aria-label={m.t("taskReorderAria", { title: m.plan.title })}
            title={m.t("taskReorderHint")}
            onKeyDown={m.onPlanGripKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </div>
        )}
        <h3 className="plan-card-title wrap">{m.plan.title}</h3>
        {m.totalSubtasks > 0 && (
          <span className="plan-card-count mono">
            {m.doneSubtasks}/{m.totalSubtasks}
          </span>
        )}
      </div>

      {/* One door for everything that is not pressed every visit. Four icons
          competing at the top of every card is what made a wall of them hard
          to read at all. */}
      <div
        className="plan-card-menu-anchor"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="btn ghost icon sm"
          aria-haspopup="menu"
          aria-expanded={m.menuOpen}
          aria-label={m.t("plansMoreActions")}
          title={m.t("plansMoreActions")}
          onClick={() => m.setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={16} />
        </button>
        {m.menuOpen && (
          <Popover align="right" onClose={() => m.setMenuOpen(false)}>
            <button
              type="button"
              className="popover-item"
              onClick={m.runFromMenu(m.togglePlanToday)}
            >
              <Sun size={14} />
              {m.isPlanToday ? m.t("removeFromToday") : m.t("assignToToday")}
            </button>
            <button
              type="button"
              className="popover-item"
              onClick={m.runFromMenu(m.openDeadlinePicker)}
            >
              <Flag size={14} />
              {m.plan.deadline
                ? m.t("deadlineOn", { date: m.plan.deadline })
                : m.t("formDeadline")}
            </button>
            <button
              type="button"
              className="popover-item"
              onClick={m.runFromMenu(m.openPlan)}
            >
              <Timer size={14} /> {m.t("plansFocusOn")}
            </button>
            <button
              type="button"
              className="popover-item danger"
              onClick={m.runFromMenu(() => m.requestDelete(m.plan.id))}
            >
              <Trash2 size={14} /> {m.t("plansDelete")}
            </button>
          </Popover>
        )}
        {/* Stays in the DOM: the menu item only asks the browser to open it,
            and a browser without `showPicker` needs something to focus. */}
        <input
          ref={m.deadlineRef}
          type="date"
          className="plan-deadline-input"
          tabIndex={-1}
          value={m.plan.deadline ?? ""}
          aria-label={m.t("formDeadline")}
          onChange={(e) =>
            m.updateTask(m.plan.id, { deadline: e.target.value || null })
          }
        />
      </div>
    </div>
  );
}
