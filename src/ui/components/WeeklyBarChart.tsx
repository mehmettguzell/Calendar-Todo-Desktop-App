import { useState } from "react";
import { CheckCircle2, Timer } from "lucide-react";
import type { WeeklyDayStat } from "@/domain/gamification";
import { useI18n } from "@/lib/i18n";
import { Segmented } from "./Segmented";

export interface WeeklyBarChartProps {
  stats: WeeklyDayStat[];
}

export function WeeklyBarChart({ stats }: WeeklyBarChartProps) {
  const { t } = useI18n();
  const [metric, setMetric] = useState<"tasks" | "focus">("tasks");

  const maxTasks = Math.max(1, ...stats.map((s) => s.tasksDone));
  const maxFocus = Math.max(1, ...stats.map((s) => s.focusMinutes));

  const totalTasksInWeek = stats.reduce((sum, s) => sum + s.tasksDone, 0);

  return (
    <div className="weekly-chart-card">
      <div className="weekly-chart-head">
        <span className="weekly-chart-title">{t("weeklyActivityTitle")}</span>
        <Segmented
          size="sm"
          ariaLabel={t("weeklyActivityTitle")}
          value={metric}
          onChange={setMetric}
          segments={[
            {
              id: "tasks",
              label: t("weeklyMetricTasks"),
              icon: <CheckCircle2 size={12} />,
              count: totalTasksInWeek,
            },
            {
              id: "focus",
              label: t("weeklyMetricFocus"),
              icon: <Timer size={12} />,
            },
          ]}
        />
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
