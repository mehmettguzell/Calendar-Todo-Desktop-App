import { CheckCircle2, Timer } from "lucide-react";
import { formatTracked } from "@/domain/datetime";
import type { WeeklyDayStat } from "@/domain/gamification";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useViewPrefs } from "@/state/viewPrefsStore";
import { Segmented } from "./Segmented";

export interface WeekStripProps {
  stats: WeeklyDayStat[];
  /** Jump to a day. The strip is navigation as well as a read-out. */
  onPickDate?: (date: string) => void;
}

/**
 * The last seven days, as days.
 *
 * This replaced a bar chart, and the reason is not that the chart was ugly.
 * It was seven abstract columns labelled Paz…Cmt with nothing you could do to
 * them: a read-out, in the most valuable space on the screen, of a number
 * nobody acts on. Meanwhile the one question you actually ask of last week —
 * "what did I have on Wednesday?" — had no answer here at all.
 *
 * So each column is now the day itself: its number, its weekday, and the same
 * activity the chart carried, drawn as a bar behind the number rather than
 * beside it. Pressing one opens that day. The metric switch survives intact,
 * because "how much did I finish" and "how long did I focus" are two different
 * weeks and the chart was right to offer both.
 *
 * Today is the only column that gets the accent. A row of seven coloured bars
 * is a row of seven things claiming to be the important one.
 */
export function WeekStrip({ stats, onPickDate }: WeekStripProps) {
  const { t } = useI18n();
  const metric = useViewPrefs((s) => s.weekMetric);
  const setMetric = useViewPrefs((s) => s.setWeekMetric);

  const totalTasks = stats.reduce((sum, day) => sum + day.tasksDone, 0);
  const peak = Math.max(
    1,
    ...stats.map((day) =>
      metric === "tasks" ? day.tasksDone : day.focusMinutes,
    ),
  );

  return (
    <div className="week-strip">
      <div className="week-strip-head">
        <span className="week-strip-title">{t("weeklyActivityTitle")}</span>
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
              count: totalTasks,
            },
            {
              id: "focus",
              label: t("weeklyMetricFocus"),
              icon: <Timer size={12} />,
            },
          ]}
        />
      </div>

      <div className="week-strip-days">
        {stats.map((day) => {
          const value =
            metric === "tasks" ? day.tasksDone : day.focusMinutes;
          const said =
            metric === "tasks"
              ? t("weekStripTasksOn", { date: day.shortDate, n: day.tasksDone })
              : t("weekStripFocusOn", {
                  date: day.shortDate,
                  time: formatTracked(day.focusMinutes * 60),
                });

          return (
            <button
              key={day.date}
              type="button"
              className={cn("week-day", day.isToday && "is-today")}
              title={said}
              aria-label={said}
              aria-current={day.isToday ? "date" : undefined}
              disabled={!onPickDate}
              onClick={() => onPickDate?.(day.date)}
            >
              <span className="week-day-name">{day.dayLabel}</span>
              <span className="week-day-num">{day.date.slice(-2)}</span>
              {/* The activity, behind the number rather than beside it: the
                  column is a day first and a measurement second. */}
              <span className="week-day-track" aria-hidden>
                <span
                  className="week-day-fill"
                  style={{
                    height: value > 0 ? `${Math.max(18, (value / peak) * 100)}%` : 0,
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
