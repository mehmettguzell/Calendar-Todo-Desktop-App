import { addDaysLocal } from "./datetime";
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
  title: string;
  minXp: number;
  maxXp: number;
}

export const LEVEL_TIERS: LevelTier[] = [
  { level: 1, title: "Acemi Planlayıcı", minXp: 0, maxXp: 100 },
  { level: 2, title: "Görev Avcısı", minXp: 100, maxXp: 250 },
  { level: 3, title: "Zaman Bükücü", minXp: 250, maxXp: 500 },
  { level: 4, title: "Üretkenlik Gurusu", minXp: 500, maxXp: 900 },
  { level: 5, title: "Odak Ustası", minXp: 900, maxXp: 1500 },
  { level: 6, title: "Disiplin Şampiyonu", minXp: 1500, maxXp: 2500 },
  { level: 7, title: "Zaman Lordu", minXp: 2500, maxXp: 4000 },
  { level: 8, title: "Tempo Efsanesi", minXp: 4000, maxXp: 7000 },
  { level: 9, title: "Üretkenlik Titanı", minXp: 7000, maxXp: 12000 },
  { level: 10, title: "Zamanın Efendisi", minXp: 12000, maxXp: Infinity },
];

export interface LevelInfo {
  level: number;
  title: string;
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
    title: "Acemi Planlayıcı",
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
    title: tier.title,
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

const TURKISH_DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

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
    const dayLabel = TURKISH_DAY_NAMES[d.getDay()] ?? "";
    const shortDate = d.toLocaleDateString("tr-TR", {
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
  title: string;
  subtitle: string;
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
      title: `${overdueCount} gecikmiş görevin var`,
      subtitle:
        "Önce bunları aradan çıkarıp kafanı rahatlatabilirsin. Sen halledersin! 💪",
      emoji: "⚡",
      badgeType: "warning",
    };
  }

  if (total === 0) {
    if (currentHour < 12) {
      return {
        title: "Günaydın! Harika bir gün seni bekliyor",
        subtitle:
          "Bugün için henüz bir görev planlanmamış. İster yeni hedefler ekle, ister anın tadını çıkar! ☕",
        emoji: "☀️",
        badgeType: "neutral",
      };
    }
    return {
      title: "Planlı görev yok, rahatla!",
      subtitle:
        "Bugün için takvimin tertemiz. Dinlenmek de üretkenliğin bir parçasıdır. 🌿",
      emoji: "🛋️",
      badgeType: "neutral",
    };
  }

  if (percent === 100 && total > 0) {
    const streakSuffix =
      streak > 1 ? ` 🔥 ${streak} günlük serin devam ediyor!` : "";
    return {
      title: "Günün Kahramanı! 🎉",
      subtitle: `Bugüne ait ${total} görevin hepsini tamamladın.${streakSuffix} Muhteşem bir iş başardın!`,
      emoji: "🏆",
      badgeType: "celebrate",
    };
  }

  if (percent >= 75) {
    return {
      title: "Zirveye çok az kaldı! 🚀",
      subtitle: `${doneCount}/${total} görev bitti (%${percent}). Son kalan ${openCount} görevi de bitirip günü fethet!`,
      emoji: "🎯",
      badgeType: "success",
    };
  }

  if (percent >= 50) {
    return {
      title: "Yolu yarıladın bile! 🔥",
      subtitle: `Harika bir tempo yakaladın (${doneCount} tamamlandı). Kalan ${openCount} görevi de aynı odakla tamamlayabilirsin.`,
      emoji: "⚡",
      badgeType: "success",
    };
  }

  if (doneCount > 0) {
    return {
      title: "Güzel bir başlangıç yaptın! ✨",
      subtitle: `${doneCount} görev bitti, ivmeyi kaybetme! Sıradaki göreve odaklan.`,
      emoji: "🌱",
      badgeType: "neutral",
    };
  }

  // 0% done
  if (currentHour < 12) {
    return {
      title: "Yeni bir gün, yeni hedefler! 🌅",
      subtitle: `Bugün tamamlanacak ${openCount} görev seni bekliyor. İlk adımı atarak harika bir başlangıç yap.`,
      emoji: "🚀",
      badgeType: "neutral",
    };
  } else if (currentHour >= 18) {
    return {
      title: "Akşam temposu! 🌙",
      subtitle: `Günü tamamlamak için ${openCount} görevin var. Sakin ve odaklı bir şekilde halledebilirsin.`,
      emoji: "💡",
      badgeType: "neutral",
    };
  }

  return {
    title: "Odaklanma Zamanı! 🎯",
    subtitle: `Bugün listende ${openCount} görev var. İlk görevi seç ve başla!`,
    emoji: "⏳",
    badgeType: "neutral",
  };
}
