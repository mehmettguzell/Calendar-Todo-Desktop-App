import { cn } from "@/lib/cn";
import { PlanCardHead } from "./PlanCardHead";
import { PlanCardMeta } from "./PlanCardMeta";
import { PlanDeadlines } from "./PlanDeadlines";
import { PlanSteps } from "./PlanSteps";
import { usePlanCard, type PlanCardInput } from "./usePlanCard";

/**
 * One plan, with its steps, progress and checkpoints.
 *
 * The card is assembled rather than written: the rules live in `usePlanCard` and
 * each band of the card draws itself from that one model, so the three sections
 * cannot drift into disagreeing about what the plan's state is.
 */
export function PlanCard({
  selected,
  ...input
}: PlanCardInput & { selected: boolean }) {
  const m = usePlanCard(input);

  return (
    <div
      className={cn(
        "plan-card",
        selected && "selected",
        m.isPlanCompleted && "completed",
        m.picking && "picking",
        m.planPicked && "picked",
        m.planDragClass,
      )}
      {...m.planDragHandlers}
    >
      <PlanCardHead model={m} />

      {m.plan.description && (
        <p className="plan-card-desc" onClick={m.activatePlan}>
          {m.plan.description}
        </p>
      )}

      <PlanCardMeta model={m} />

      {m.totalSubtasks > 0 && (
        <div className="plan-progress-track" aria-hidden>
          <div
            className="plan-progress-bar"
            style={{ width: `${m.progressPct}%` }}
          />
        </div>
      )}

      <PlanDeadlines taskId={m.plan.id} today={m.today} />

      <PlanSteps model={m} />
    </div>
  );
}
