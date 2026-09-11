import {
  useNow,
  useStore,
} from "../store";
import {
  addDaysLocal,
  localeTag,
  toLocalDate,
} from "@/domain/datetime";
import {
  calculateLevel,
  calculateTotalXp,
  computeActivityMap,
  computeStreaks,
  computeWeeklyStats,
  type DayActivity,
  type LevelInfo,
  type StreakInfo,
  type WeeklyDayStat,
} from "@/domain/gamification";
import { LocalDate } from "@/domain/types";
import { useMemo } from "react";

// Streaks, XP and the heatmap: everything derived from the activity map.
/**
 * Computes an activity map for all recorded tasks, occurrences, focus sessions, and history.
 */
export function useActivityMap(): Map<LocalDate, DayActivity> {
  const tasks = useStore((s) => s.db.tasks);
  const occurrences = useStore((s) => s.db.occurrences);
  const focusSessions = useStore((s) => s.db.focusSessions);
  const history = useStore((s) => s.db.history);

  return useMemo(
    () => computeActivityMap(tasks, occurrences, focusSessions, history),
    [tasks, occurrences, focusSessions, history],
  );
}

export interface GamificationStats {
  levelInfo: LevelInfo;
  streaks: StreakInfo;
  totalXp: number;
  activityMap: Map<LocalDate, DayActivity>;
}

/**
 * Computes user level, total XP, current/longest streaks, and active status.
 */
export function useGamificationStats(): GamificationStats {
  const activityMap = useActivityMap();
  const now = useNow();
  const today = toLocalDate(now);

  return useMemo(() => {
    const totalXp = calculateTotalXp(activityMap);
    const levelInfo = calculateLevel(totalXp);
    const streaks = computeStreaks(activityMap, today);
    return {
      levelInfo,
      streaks,
      totalXp,
      activityMap,
    };
  }, [activityMap, today]);
}

/**
 * 7-day stats ending on today for mini bar chart.
 */
export function useWeeklyStatsHook(daysCount = 7): WeeklyDayStat[] {
  const activityMap = useActivityMap();
  const now = useNow();
  const today = toLocalDate(now);

  return useMemo(
    () => computeWeeklyStats(activityMap, today, daysCount),
    [activityMap, today, daysCount],
  );
}

export interface HeatmapDay {
  date: LocalDate;
  dayOfWeek: number; // 0 = Sun..6 = Sat
  activity: DayActivity | null;
  isToday: boolean;
  isFuture: boolean;
}

export interface HeatmapWeek {
  weekIndex: number;
  days: HeatmapDay[];
  monthLabel?: string;
}

/**
 * Generates weeks grid structure for the GitHub-style Heatmap (past N weeks ending this week).
 */
export function useActivityHeatmapWeeks(weeksCount = 20): HeatmapWeek[] {
  const activityMap = useActivityMap();
  const now = useNow();
  const today = toLocalDate(now);

  return useMemo(() => {
    const todayObj = new Date(today + "T00:00:00");
    // Align end of grid with the end of current week (Sunday = 0, Monday = 1.. Saturday = 6)
    // In GitHub heatmap, columns are weeks (Mon-Sun or Sun-Sat). Let's use Monday as day 0 of week column.
    const currentDayOfWeek = todayObj.getDay(); // 0 is Sunday, 1 is Monday ...
    const offsetToWeekEnd =
      (7 - (currentDayOfWeek === 0 ? 7 : currentDayOfWeek)) % 7; // days until Sunday
    const gridEndDate = addDaysLocal(today, offsetToWeekEnd);

    const totalDays = weeksCount * 7;
    const gridStartDate = addDaysLocal(gridEndDate, -(totalDays - 1));

    const weeks: HeatmapWeek[] = [];
    let lastMonth = -1;

    for (let w = 0; w < weeksCount; w++) {
      const days: HeatmapDay[] = [];
      let weekMonthLabel: string | undefined = undefined;

      for (let d = 0; d < 7; d++) {
        const dayOffset = w * 7 + d;
        const date = addDaysLocal(gridStartDate, dayOffset);
        const dayObj = new Date(date + "T00:00:00");
        const month = dayObj.getMonth();

        // If the month changed on the first day or middle of the week, add month label
        if (d === 0 && month !== lastMonth) {
          weekMonthLabel = dayObj.toLocaleString(localeTag(), { month: "short" });
          lastMonth = month;
        }

        const isToday = date === today;
        const isFuture = date > today;
        const activity = activityMap.get(date) ?? null;

        days.push({
          date,
          dayOfWeek: dayObj.getDay(),
          activity,
          isToday,
          isFuture,
        });
      }

      weeks.push({
        weekIndex: w,
        days,
        monthLabel: weekMonthLabel,
      });
    }

    return weeks;
  }, [activityMap, today, weeksCount]);
}
