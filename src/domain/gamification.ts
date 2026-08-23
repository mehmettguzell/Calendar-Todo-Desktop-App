import { addDaysLocal, localeTag, weekdayNames } from "./datetime";
import type {
  FocusSession,
  HistoryEntry,
  LocalDate,
  Occurrence,
  Task,
} from "./types";

export const XP_PER_TASK = 10;
export const XP_PER_FOCUS_SESSION = 20;

export interface LevelTier {
  level: number;
  titleKey: string;
  minXp: number;
  maxXp: number;
}

export const LEVEL_TIERS: LevelTier[] = [
  { level: 1, titleKey: "tier1", minXp: 0, maxXp: 100 },
  { level: 2, titleKey: "tier2", minXp: 100, maxXp: 250 },
  { level: 3, titleKey: "tier3", minXp: 250, maxXp: 500 },
  { level: 4, titleKey: "tier4", minXp: 500, maxXp: 900 },
  { level: 5, titleKey: "tier5", minXp: 900, maxXp: 1500 },
  { level: 6, titleKey: "tier6", minXp: 1500, maxXp: 2500 },
  { level: 7, titleKey: "tier7", minXp: 2500, maxXp: 4000 },
  { level: 8, titleKey: "tier8", minXp: 4000, maxXp: 7000 },
  { level: 9, titleKey: "tier9", minXp: 7000, maxXp: 12000 },
  { level: 10, titleKey: "tier10", minXp: 12000, maxXp: Infinity },
];

export interface LevelInfo {
  level: number;
  titleKey: string;
  totalXp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpInCurrentLevel: number;
  xpNeededForNextLevel: number;
  progressPercent: number;
}

export interface DayActivity {
  date: LocalDate;
  tasksDone: number;
  focusSec: number;
  focusMinutes: number;
  xp: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  totalActiveDays: number;
  isActiveToday: boolean;
}

export interface WeeklyDayStat {
  date: LocalDate;
  dayLabel: string;
  shortDate: string;
  tasksDone: number;
  focusMinutes: number;
  xp: number;
  isToday: boolean;
}

/**
 * Calculates level information given total XP.
 */
export function calculateLevel(totalXp: number): LevelInfo {
  const safeXp = Math.max(0, totalXp);
  const fallbackTier: LevelTier = LEVEL_TIERS[LEVEL_TIERS.length - 1] ?? {
    level: 1,
    titleKey: "tier1",
    minXp: 0,
    maxXp: 100,
  };
  const tier: LevelTier =
    LEVEL_TIERS.find((t) => safeXp >= t.minXp && safeXp < t.maxXp) ??
    fallbackTier;

  const isMax = tier.maxXp === Infinity;
  const xpInCurrentLevel = safeXp - tier.minXp;
  const xpNeededForNextLevel = isMax ? 1000 : tier.maxXp - tier.minXp;
  const progressPercent = isMax
    ? 100
    : Math.min(
        100,
        Math.max(
          0,
          Math.round((xpInCurrentLevel / xpNeededForNextLevel) * 100),
        ),
      );

  return {
    level: tier.level,
    titleKey: tier.titleKey,
    totalXp: safeXp,
    currentLevelXp: tier.minXp,
    nextLevelXp: tier.maxXp,
    xpInCurrentLevel,
    xpNeededForNextLevel,
    progressPercent,
  };
}

/**
 * Computes a map of date -> DayActivity based on all tasks, occurrences, focus sessions, and history.
 */
export function computeActivityMap(
  tasks: Task[],
  occurrences: Occurrence[],
  focusSessions: FocusSession[],
  history: HistoryEntry[],
): Map<LocalDate, DayActivity> {
  const map = new Map<
    LocalDate,
    { tasksDone: number; focusSec: number; focusSessionsCount: number }
  >();

  const getOrCreate = (date: LocalDate) => {
    let item = map.get(date);
    if (!item) {
      item = { tasksDone: 0, focusSec: 0, focusSessionsCount: 0 };
      map.set(date, item);
    }
    return item;
  };

  // 1. Completed events from history (most granular source for when completions happened)
  const completedTaskDateMap = new Set<string>();
  for (const h of history) {
    if (h.kind === "STATUS_CHANGED" && h.to === "COMPLETED") {
      const date = h.at.slice(0, 10);
      const key = `${h.taskId}::${h.occurrenceDate ?? ""}::${date}`;
      if (!completedTaskDateMap.has(key)) {
        completedTaskDateMap.add(key);
        getOrCreate(date).tasksDone += 1;
      }
    }
  }

  // Fallback for completed tasks without history entries
  for (const task of tasks) {
    if (task.status === "COMPLETED" && task.completedAt) {
      const date = task.completedAt.slice(0, 10);
      const key = `${task.id}::::${date}`;
      if (!completedTaskDateMap.has(key)) {
        completedTaskDateMap.add(key);
        getOrCreate(date).tasksDone += 1;
      }
    }
  }

  for (const occ of occurrences) {
    if (occ.status === "COMPLETED" && occ.completedAt) {
      const date = occ.completedAt.slice(0, 10);
      const key = `${occ.taskId}::${occ.date}::${date}`;
      if (!completedTaskDateMap.has(key)) {
        completedTaskDateMap.add(key);
        getOrCreate(date).tasksDone += 1;
      }
    }
  }

  // 2. Focus sessions
  for (const session of focusSessions) {
    const date = session.startedAt.slice(0, 10);
    const item = getOrCreate(date);
    item.focusSec += session.durationSec;
    item.focusSessionsCount += 1;
  }

  const result = new Map<LocalDate, DayActivity>();

  for (const [date, item] of map.entries()) {
    const focusMinutes = Math.round(item.focusSec / 60);
    const xp =
      item.tasksDone * XP_PER_TASK +
      item.focusSessionsCount * XP_PER_FOCUS_SESSION;

    // Intensity calculation (0-4)
    // Activity score: 1 task = 2 pts, 15 min focus = 2 pts
    const score = item.tasksDone * 2 + Math.floor(focusMinutes / 15) * 2;
    let intensity: 0 | 1 | 2 | 3 | 4 = 0;
    if (score >= 8 || item.tasksDone >= 5 || focusMinutes >= 90) intensity = 4;
    else if (score >= 5 || item.tasksDone >= 3 || focusMinutes >= 45)
      intensity = 3;
    else if (score >= 3 || item.tasksDone >= 2 || focusMinutes >= 20)
      intensity = 2;
    else if (score > 0 || item.tasksDone > 0 || focusMinutes > 0) intensity = 1;

    result.set(date, {
      date,
      tasksDone: item.tasksDone,
      focusSec: item.focusSec,
      focusMinutes,
      xp,
      intensity,
    });
  }

  return result;
}

/**
 * Calculates total XP across all activities.
 */
export function calculateTotalXp(
  activityMap: Map<LocalDate, DayActivity>,
): number {
  let total = 0;
  for (const activity of activityMap.values()) {
    total += activity.xp;
  }
  return total;
}

/**
 * Computes current streak, longest streak, and total active days.
 */
export function computeStreaks(
  activityMap: Map<LocalDate, DayActivity>,
  today: LocalDate,
): StreakInfo {
  const isDayActive = (date: LocalDate): boolean => {
    const act = activityMap.get(date);
    if (!act) return false;
    return act.tasksDone > 0 || act.focusSec >= 60;
  };

  const isActiveToday = isDayActive(today);

  // 1. Current streak
  let currentStreak = 0;
  let checkDate = today;

  if (isActiveToday) {
    currentStreak = 1;
    checkDate = addDaysLocal(today, -1);
    while (isDayActive(checkDate)) {
      currentStreak += 1;
      checkDate = addDaysLocal(checkDate, -1);
    }
  } else {
    // If today is not active yet, check if streak from yesterday is alive
    const yesterday = addDaysLocal(today, -1);
    if (isDayActive(yesterday)) {
      currentStreak = 1;
      checkDate = addDaysLocal(yesterday, -1);
      while (isDayActive(checkDate)) {
        currentStreak += 1;
        checkDate = addDaysLocal(checkDate, -1);
      }
    }
  }

  // 2. Longest streak & total active days
  let totalActiveDays = 0;
  let longestStreak = 0;
  let runningStreak = 0;

  const sortedDates = Array.from(activityMap.keys())
    .filter((d) => isDayActive(d))
    .sort();

  totalActiveDays = sortedDates.length;

  if (sortedDates.length > 0) {
    let prevDate = sortedDates[0];
    runningStreak = 1;
    longestStreak = 1;

    for (let i = 1; i < sortedDates.length; i++) {
      const currDate = sortedDates[i];
      if (!currDate || !prevDate) continue;
      const expectedNext = addDaysLocal(prevDate, 1);
      if (currDate === expectedNext) {
        runningStreak += 1;
      } else {
        runningStreak = 1;
      }
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
      prevDate = currDate;
    }
  }

  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  return {
    currentStreak,
    longestStreak,
    totalActiveDays,
    isActiveToday,
  };
}

/**
 * Computes weekly stats for the last N days (defaults to 7).
 */
export function computeWeeklyStats(
  activityMap: Map<LocalDate, DayActivity>,
  today: LocalDate,
  daysCount = 7,
): WeeklyDayStat[] {
  const stats: WeeklyDayStat[] = [];

  for (let i = daysCount - 1; i >= 0; i--) {
    const date = addDaysLocal(today, -i);
    const act = activityMap.get(date);
    const d = new Date(date + "T00:00:00");
    const dayLabel = weekdayNames("short")[d.getDay()] ?? "";
    const shortDate = d.toLocaleDateString(localeTag(), {
      day: "numeric",
      month: "short",
    });

    stats.push({
      date,
      dayLabel,
      shortDate,
      tasksDone: act?.tasksDone ?? 0,
      focusMinutes: act?.focusMinutes ?? 0,
      xp: act?.xp ?? 0,
      isToday: date === today,
    });
  }

  return stats;
}

export interface MotivationOptions {
  openCount: number;
  doneCount: number;
  overdueCount: number;
  streak: number;
  currentHour?: number;
}

export interface MotivationalMessage {
  /** Dictionary keys, not sentences: this module picks the mood, not the words. */
  titleKey: string;
  subtitleKey: string;
  params?: Record<string, string | number>;
  /** Set when the "your streak lives on" clause belongs in the subtitle. */
  streakDays?: number;
  emoji: string;
  badgeType: "neutral" | "success" | "warning" | "celebrate";
}

/**
 * Generates dynamic, context-aware motivational messages.
 */
export function getMotivationalMessage(
  options: MotivationOptions,
): MotivationalMessage {
  const {
    openCount,
    doneCount,
    overdueCount,
    streak,
    currentHour = new Date().getHours(),
  } = options;
  const total = openCount + doneCount;
  const percent = total === 0 ? 100 : Math.round((doneCount / total) * 100);

  if (overdueCount > 0 && openCount > 0) {
    return {
      titleKey: "motivOverdueTitle",
      subtitleKey: "motivOverdueSub",
      params: { n: overdueCount },
      emoji: "⚡",
      badgeType: "warning",
    };
  }

  if (total === 0) {
    if (currentHour < 12) {
      return {
        titleKey: "motivMorningEmptyTitle",
        subtitleKey: "motivMorningEmptySub",
        emoji: "☀️",
        badgeType: "neutral",
      };
    }
    return {
      titleKey: "motivEmptyTitle",
      subtitleKey: "motivEmptySub",
      emoji: "🛋️",
      badgeType: "neutral",
    };
  }

  if (percent === 100) {
    return {
      titleKey: "motivAllDoneTitle",
      subtitleKey: "motivAllDoneSub",
      params: { total, streak: "" },
      // The streak clause is a whole phrase rather than glued-on words, so the
      // sentence it joins can put it wherever that language wants it.
      ...(streak > 1 ? { streakDays: streak } : {}),
      emoji: "🏆",
      badgeType: "celebrate",
    };
  }

  if (percent >= 75) {
    return {
      titleKey: "motivAlmostTitle",
      subtitleKey: "motivAlmostSub",
      params: { done: doneCount, total, percent, open: openCount },
      emoji: "🎯",
      badgeType: "success",
    };
  }

  if (percent >= 50) {
    return {
      titleKey: "motivHalfTitle",
      subtitleKey: "motivHalfSub",
      params: { done: doneCount, open: openCount },
      emoji: "⚡",
      badgeType: "success",
    };
  }

  if (doneCount > 0) {
    return {
      titleKey: "motivStartedTitle",
      subtitleKey: "motivStartedSub",
      params: { done: doneCount },
      emoji: "🌱",
      badgeType: "neutral",
    };
  }

  if (currentHour < 12) {
    return {
      titleKey: "motivMorningTitle",
      subtitleKey: "motivMorningSub",
      params: { open: openCount },
      emoji: "🚀",
      badgeType: "neutral",
    };
  }
  if (currentHour >= 18) {
    return {
      titleKey: "motivEveningTitle",
      subtitleKey: "motivEveningSub",
      params: { open: openCount },
      emoji: "💡",
      badgeType: "neutral",
    };
  }

  return {
    titleKey: "motivFocusTitle",
    subtitleKey: "motivFocusSub",
    params: { open: openCount },
    emoji: "⏳",
    badgeType: "neutral",
  };
}
