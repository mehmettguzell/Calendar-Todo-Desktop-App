import {
  AlarmClock,
  Plus,
} from "lucide-react";
import {
  localeTag,
} from "@/domain/datetime";
import { cn } from "@/lib/cn";
import type { TaskPanelModel } from "./useTaskPanel";

/**
 * What the task's own history says about how it is going.
 *
 * Reading only: nothing is stored and nothing changes. Below three postponements
 * this draws nothing at all.
 */
export function ResistanceCard({ model: m }: { model: TaskPanelModel }) {
  if (m.resistance.level === "none") return null;

  return (
      <div className={cn("card", "resistance", m.resistance.level)}>
        <div className="resistance-head">
          <AlarmClock size={14} aria-hidden />
          <span>
            {m.t(
              m.resistance.level === "stuck"
                ? "resistanceStuck"
                : "resistanceNoticed",
              { count: m.resistance.postponements },
            )}
          </span>
        </div>
        {m.resistance.since ? (
          <p className="faint">
            {m.t("resistanceSince", {
              date: new Date(m.resistance.since).toLocaleDateString(localeTag()),
            })}
          </p>
        ) : null}
        <p className="faint">{m.t("resistanceHint")}</p>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            m.createTask({
              title: m.t("resistanceFirstStep"),
              parentId: m.task.id,
              categoryId: m.task.categoryId,
              estimateMinutes: 10,
            })
          }
        >
          <Plus size={14} />
          {m.t("resistanceAction")}
        </button>
      </div>
  );
}
