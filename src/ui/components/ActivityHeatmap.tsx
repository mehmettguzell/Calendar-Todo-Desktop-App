import { useState } from "react";
import { Award, Flame, Sparkles, Zap } from "lucide-react";
import type { StreakInfo } from "@/domain/gamification";
import { useActivityHeatmapWeeks, type HeatmapDay } from "@/state/selectors";

export interface ActivityHeatmapProps {
  streaks: StreakInfo;
  totalXp: number;
}

const DAY_LABELS = ["Pzt", "", "Çar", "", "Cum", "", "Paz"];

export function ActivityHeatmap({ streaks, totalXp }: ActivityHeatmapProps) {
  const weeks = useActivityHeatmapWeeks(24);
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);

  return (
    <div className="activity-heatmap-card section">
      {/* Streak & XP Stats Banner */}
      <div className="heatmap-stats-banner">
        <div className="heatmap-stat-item">
          <div className="heatmap-stat-icon-box flame">
            <Flame size={18} />
          </div>
          <div>
            <div className="heatmap-stat-val">
              {streaks.currentStreak}{" "}
              <span className="heatmap-stat-unit">gün</span>
            </div>
            <div className="heatmap-stat-lbl">
              Mevcut Seri{" "}
              {streaks.isActiveToday ? "🔥" : "(Bugün henüz aktif değil)"}
            </div>
          </div>
        </div>

        <div className="heatmap-stat-item">
          <div className="heatmap-stat-icon-box trophy">
            <Award size={18} />
          </div>
          <div>
            <div className="heatmap-stat-val">
              {streaks.longestStreak}{" "}
              <span className="heatmap-stat-unit">gün</span>
            </div>
            <div className="heatmap-stat-lbl">En Uzun Seri</div>
          </div>
        </div>

        <div className="heatmap-stat-item">
          <div className="heatmap-stat-icon-box zap">
            <Zap size={18} />
          </div>
          <div>
            <div className="heatmap-stat-val">{streaks.totalActiveDays}</div>
            <div className="heatmap-stat-lbl">Aktif Gün</div>
          </div>
        </div>

        <div className="heatmap-stat-item">
          <div className="heatmap-stat-icon-box xp">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="heatmap-stat-val">{totalXp.toLocaleString()}</div>
            <div className="heatmap-stat-lbl">Kazanılan XP</div>
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="heatmap-grid-wrapper">
        <div className="heatmap-day-names">
          {DAY_LABELS.map((lbl, idx) => (
            <span key={idx} className="heatmap-day-name">
              {lbl}
            </span>
          ))}
        </div>

        <div className="heatmap-weeks-scroll scroll">
          <div className="heatmap-weeks-container">
            {/* Month header labels */}
            <div className="heatmap-months-row">
              {weeks.map((w, idx) => (
                <div key={idx} className="heatmap-month-col">
                  {w.monthLabel ? (
                    <span className="heatmap-month-lbl">{w.monthLabel}</span>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Days Grid Columns */}
            <div className="heatmap-columns-row">
              {weeks.map((week) => (
                <div key={week.weekIndex} className="heatmap-week-col">
                  {week.days.map((day) => {
                    const intensity = day.activity?.intensity ?? 0;
                    const isFuture = day.isFuture;

                    return (
                      <div
                        key={day.date}
                        className={`heatmap-cell intensity-${intensity} ${
                          day.isToday ? "is-today" : ""
                        } ${isFuture ? "is-future" : ""}`}
                        onMouseEnter={() => setHoveredDay(day)}
                        onMouseLeave={() => setHoveredDay(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap Footer: Hover Details & Legend */}
      <div className="heatmap-foot">
        <div className="heatmap-hover-info">
          {hoveredDay ? (
            <span>
              <strong>{hoveredDay.date}:</strong>{" "}
              {hoveredDay.activity ? (
                <>
                  {hoveredDay.activity.tasksDone} görev tamamlandı
                  {hoveredDay.activity.focusMinutes > 0 &&
                    ` • ${hoveredDay.activity.focusMinutes} dk odaklanma`}
                  {` • +${hoveredDay.activity.xp} XP`}
                </>
              ) : hoveredDay.isFuture ? (
                "Gelecek gün"
              ) : (
                "Kayıtlı aktivite yok"
              )}
            </span>
          ) : (
            <span className="faint">
              Detayları görmek için bir günün üzerine gelin
            </span>
          )}
        </div>

        <div className="heatmap-legend">
          <span className="faint">Az</span>
          <div className="heatmap-cell intensity-0" />
          <div className="heatmap-cell intensity-1" />
          <div className="heatmap-cell intensity-2" />
          <div className="heatmap-cell intensity-3" />
          <div className="heatmap-cell intensity-4" />
          <span className="faint">Çok</span>
        </div>
      </div>
    </div>
  );
}
