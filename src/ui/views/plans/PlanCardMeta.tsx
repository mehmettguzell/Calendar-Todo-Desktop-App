import { cn } from "@/lib/cn";
import {
  CheckCircle2,
  Circle,
  CircleDot,
  Flag,
  Sun,
} from "lucide-react";
import type { PlanCardModel } from "./usePlanCard";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The stage chip and the context around it.
 *
 * The chip leads because it is the one control on the card and the fact the tabs
 * above sort by; each pill after it is drawn only when it has something to say.
 */
export function PlanCardMeta({ model: m }: { model: PlanCardModel }) {
  return (
    <div className="plan-card-meta-row">
      {m.isPlanCompleted ? (
        <span className="plan-stage-chip is-completed">
          <CheckCircle2 size={12} /> {m.t("statusCOMPLETED")}
        </span>
      ) : (
        <button
          type="button"
          className={cn(
            "plan-stage-chip",
            m.stage === "STARTED" ? "is-started" : "is-not-started",
          )}
          aria-pressed={m.stage === "STARTED"}
          title={
            m.stage === "STARTED" ? m.t("planUnstartAction") : m.t("planStartAction")
          }
          onClick={m.toggleStarted}
        >
          {m.stage === "STARTED" ? (
            <>
              <CircleDot size={12} /> {m.t("planStageSTARTED")}
            </>
          ) : (
            <>
              <Circle size={12} /> {m.t("planStageNOT_STARTED")}
            </>
          )}
        </button>
      )}
      {m.isPlanToday && (
        <span
          className="meta-pill is-today"
          title={m.t("plansAddedToToday")}
        >
          <Sun size={11} /> {m.t("today")}
        </span>
      )}
      {m.category && (
        <span className="meta-item">
          <i className="dot" style={{ background: m.category.color }} />
          {m.category.name}
        </span>
      )}
      {/* Only HIGH is worth a colour. A priority tag on every card, in three
          shades, is a traffic light nobody can read; the one that means "do
          this first" should be visible from across the page. */}
      {m.plan.priority === "HIGH" ? (
        <span className="meta-pill is-overdue">{m.t("priorityHIGH")}</span>
      ) : m.plan.priority !== "NONE" ? (
        <span className="meta-item">{m.t(`priority${m.plan.priority}` as TranslationKey)}</span>
      ) : null}
      {/* On the pill line rather than beside the name: a plan's title is the
          one thing that must never be the part that gets truncated. */}
      {m.plan.deadline && (
        <span
          className={cn("meta-item", m.planOverdue && "is-overdue")}
          title={m.t("deadlineOn", { date: m.plan.deadline })}
        >
          <Flag size={11} aria-hidden /> {m.plan.deadline}
        </span>
      )}
    </div>
  );
}
