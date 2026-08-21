import { useState } from "react";
import { BarChart2, CheckCircle2, Timer } from "lucide-react";
import type { WeeklyDayStat } from "@/domain/gamification";
import { formatTracked } from "@/domain/datetime";

export interface WeeklyBarChartProps {
  stats: WeeklyDayStat[];
}

export function WeeklyBarChart({ stats }: WeeklyBarChartProps) {
  const [metric, setMetric] = useState<"tasks" | "focus">("tasks");

  const maxTasks = Math.max(1, ...stats.map((s) => s.tasksDone));
  const maxFocus = Math.max(1, ...stats.map((s) => s.focusMinutes));

  const totalTasksInWeek = stats.reduce((sum, s) => sum + s.tasksDone, 0);
  const totalFocusSecInWeek = stats.reduce(
    (sum, s) => sum + s.focusMinutes * 60,
    0,
  );

  return (
    <div className="weekly-chart-card">
      <div className="weekly-chart-head">
        <div className="weekly-chart-title">
          <BarChart2 size={15} />
          <span>Haftalık Aktivite (Son 7 Gün)</span>
        </div>
        <div className="weekly-chart-toggles">
          <button
            type="button"
            className={`btn-toggle sm ${metric === "tasks" ? "active" : ""}`}
            onClick={() => setMetric("tasks")}
          >
            <CheckCircle2 size={12} /> Görevler ({totalTasksInWeek})
          </button>
          <button
            type="button"
            className={`btn-toggle sm ${metric === "focus" ? "active" : ""}`}
            onClick={() => setMetric("focus")}
          >
            <Timer size={12} /> Focus ({formatTracked(totalFocusSecInWeek)})
          </button>
        </div>
      </div>

      <div className="weekly-bars-container">
        {stats.map((day) => {
          const val = metric === "tasks" ? day.tasksDone : day.focusMinutes;
          const maxVal = metric === "tasks" ? maxTasks : maxFocus;
          const heightPercent =
            val > 0 ? Math.max(14, Math.round((val / maxVal) * 100)) : 6;

          const tooltip =
            metric === "tasks"
              ? `${day.shortDate}: ${day.tasksDone} görev tamamlandı (+${day.xp} XP)`
              : `${day.shortDate}: ${day.focusMinutes} dk odaklanma`;

          return (
            <div
              key={day.date}
              className={`weekly-bar-col ${day.isToday ? "is-today" : ""}`}
              title={tooltip}
            >
              <div className="weekly-bar-track">
                <div
                  className={`weekly-bar-fill ${val > 0 ? "has-val" : "zero"} ${day.isToday ? "today-fill" : ""}`}
                  style={{ height: `${heightPercent}%` }}
                >
                  {val > 0 ? (
                    <span className="weekly-bar-val">{val}</span>
                  ) : null}
                </div>
              </div>
              <div className="weekly-bar-label">
                <span>{day.dayLabel}</span>
                {day.isToday && <span className="today-dot" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
