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
interface DayTally {
  tasksDone: number;
  focusSec: number;
  focusSessionsCount: number;
}

/** One tally per day, created on first touch. */
class Tallies {
  private readonly byDate = new Map<LocalDate, DayTally>();

  on(date: LocalDate): DayTally {
    let tally = this.byDate.get(date);
    if (!tally) {
      tally = { tasksDone: 0, focusSec: 0, focusSessionsCount: 0 };
      this.byDate.set(date, tally);
    }
    return tally;
  }

  entries(): [LocalDate, DayTally][] {
    return [...this.byDate.entries()];
  }
}

/**
 * Count each completion once, from whichever source saw it.
 *
 * History is the most granular record of *when* something was finished, but a
 * task completed before the trail existed has only its own `completedAt`, and a
 * recurring one has the occurrence row. The key is what keeps the three sources
 * from counting the same completion three times.
 */
function countCompletions(
  tallies: Tallies,
  tasks: Task[],
  occurrences: Occurrence[],
  history: HistoryEntry[],
): void {
  const counted = new Set<string>();
  const once = (key: string, date: LocalDate) => {
    if (counted.has(key)) return;
    counted.add(key);
    tallies.on(date).tasksDone += 1;
  };

  for (const h of history) {
    if (h.kind !== "STATUS_CHANGED" || h.to !== "COMPLETED") continue;
    const date = h.at.slice(0, 10);
    once(`${h.taskId}::${h.occurrenceDate ?? ""}::${date}`, date);
  }
  for (const task of tasks) {
    if (task.status !== "COMPLETED" || !task.completedAt) continue;
    const date = task.completedAt.slice(0, 10);
    once(`${task.id}::::${date}`, date);
  }
  for (const occ of occurrences) {
    if (occ.status !== "COMPLETED" || !occ.completedAt) continue;
    const date = occ.completedAt.slice(0, 10);
    once(`${occ.taskId}::${occ.date}::${date}`, date);
  }
}

/**
 * How dark the heatmap square is, 0–4.
 *
 * Tasks and focus both count: one task is two points, so is every quarter hour
 * of focus. The absolute thresholds beside the score are what stop a day of
 * pure focus, or pure ticking, from reading as a quiet one — a day clears a
 * level by meeting *any* of its three.
 */
const INTENSITY_LADDER: { level: 1 | 2 | 3 | 4; score: number; tasks: number; minutes: number }[] = [
  { level: 4, score: 8, tasks: 5, minutes: 90 },
  { level: 3, score: 5, tasks: 3, minutes: 45 },
  { level: 2, score: 3, tasks: 2, minutes: 20 },
  { level: 1, score: 1, tasks: 1, minutes: 1 },
];

function intensityOf(tasksDone: number, focusMinutes: number): 0 | 1 | 2 | 3 | 4 {
  const score = tasksDone * 2 + Math.floor(focusMinutes / 15) * 2;
  const step = INTENSITY_LADDER.find(
    (rung) =>
      score >= rung.score || tasksDone >= rung.tasks || focusMinutes >= rung.minutes,
  );
  return step?.level ?? 0;
}

export function computeActivityMap(
  tasks: Task[],
  occurrences: Occurrence[],
  focusSessions: FocusSession[],
  history: HistoryEntry[],
): Map<LocalDate, DayActivity> {
  const tallies = new Tallies();
  countCompletions(tallies, tasks, occurrences, history);
  for (const session of focusSessions) {
    const tally = tallies.on(session.startedAt.slice(0, 10));
    tally.focusSec += session.durationSec;
    tally.focusSessionsCount += 1;
  }

  const result = new Map<LocalDate, DayActivity>();
  for (const [date, tally] of tallies.entries()) {
    const focusMinutes = Math.round(tally.focusSec / 60);
    result.set(date, {
      date,
      tasksDone: tally.tasksDone,
      focusSec: tally.focusSec,
      focusMinutes,
      xp:
        tally.tasksDone * XP_PER_TASK +
        tally.focusSessionsCount * XP_PER_FOCUS_SESSION,
      intensity: intensityOf(tally.tasksDone, focusMinutes),
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
/** A day counts when something was finished on it, or a minute was focused. */
function activeOn(
  activityMap: Map<LocalDate, DayActivity>,
  date: LocalDate,
): boolean {
  const day = activityMap.get(date);
  return day !== undefined && (day.tasksDone > 0 || day.focusSec >= 60);
}

/** How many consecutive active days end at `from`, counting backwards. */
function runEndingAt(
  activityMap: Map<LocalDate, DayActivity>,
  from: LocalDate,
): number {
  if (!activeOn(activityMap, from)) return 0;
  let length = 1;
  let date = addDaysLocal(from, -1);
  while (activeOn(activityMap, date)) {
    length += 1;
    date = addDaysLocal(date, -1);
  }
  return length;
}

/** The longest run anywhere in the record, and how many active days there are. */
function longestRun(activityMap: Map<LocalDate, DayActivity>): {
  longest: number;
  totalActiveDays: number;
} {
  const dates = [...activityMap.keys()].filter((d) => activeOn(activityMap, d)).sort();
  let longest = dates.length > 0 ? 1 : 0;
  let running = longest;
  for (let i = 1; i < dates.length; i += 1) {
    const current = dates[i];
    const previous = dates[i - 1];
    if (!current || !previous) continue;
    running = current === addDaysLocal(previous, 1) ? running + 1 : 1;
    if (running > longest) longest = running;
  }
  return { longest, totalActiveDays: dates.length };
}

export function computeStreaks(
  activityMap: Map<LocalDate, DayActivity>,
  today: LocalDate,
): StreakInfo {
  const isActiveToday = activeOn(activityMap, today);
  // A streak is not broken until the day after it could have continued: with
  // nothing done yet today, yesterday's run is still alive.
  const currentStreak = isActiveToday
    ? runEndingAt(activityMap, today)
    : runEndingAt(activityMap, addDaysLocal(today, -1));

  const { longest, totalActiveDays } = longestRun(activityMap);
  return {
    currentStreak,
    longestStreak: Math.max(longest, currentStreak),
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
