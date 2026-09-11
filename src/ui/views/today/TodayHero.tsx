import { Flame } from "lucide-react";
import { formatTracked, localeTag } from "@/domain/datetime";
import { getMotivationalMessage } from "@/domain/motivation";
import type { LocalDate } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fireConfetti } from "@/lib/confetti";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { WeeklyDayStat } from "@/domain/gamification";
import { ProgressRing } from "@/ui/components/ProgressRing";
import { WeekStrip } from "@/ui/components/WeekStrip";

export interface TodayCounts {
  open: number;
  done: number;
  overdue: number;
  streak: number;
  focusedSec: number;
}

/** The one card that is true whether or not there is any work on the day. */
export function TodayHero({
  now,
  counts,
  weeklyStats,
  onPickDate,
}: {
  now: Date;
  counts: TodayCounts;
  weeklyStats: WeeklyDayStat[];
  onPickDate?: (date: LocalDate) => void;
}) {
  // A chart of seven empty days is the first thing a new account would see, and
  // it says nothing except that there is nothing. It arrives with the first
  // finished task and stays from then on.
  const hasWeekHistory = weeklyStats.some(
    (day) => day.tasksDone > 0 || day.focusMinutes > 0,
  );

  return (
    <div className={cn("today-hero-card section", !hasWeekHistory && "is-solo")}>
      <div className="today-hero-left">
        <ProgressRing
          completed={counts.done}
          total={counts.done + counts.open}
          size={76}
          strokeWidth={7}
          onCelebrate={() => fireConfetti({ particleCount: 100 })}
        />

        <div className="today-hero-text">
          <HeroDate now={now} />
          <HeroMessage counts={counts} />
          <HeroStats counts={counts} />
        </div>
      </div>

      {hasWeekHistory ? (
        <div className="today-hero-right">
          <WeekStrip stats={weeklyStats} onPickDate={onPickDate} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The date is the headline.
 *
 * A day planner that never printed the date: the topbar said "Bugün", the
 * sidebar held a mini month, and the screen you open first every morning never
 * told you what day it was. Split in two so the weekday can sit above the date
 * at a different weight, which is what makes the pair read as a heading rather
 * than a timestamp.
 */
function HeroDate({ now }: { now: Date }) {
  return (
    <div className="today-date">
      <span className="today-date-weekday">
        {now.toLocaleDateString(localeTag(), { weekday: "long" })}
      </span>
      <h2 className="today-date-day">
        {now.toLocaleDateString(localeTag(), { day: "numeric", month: "long" })}
      </h2>
    </div>
  );
}

function HeroMessage({ counts }: { counts: TodayCounts }) {
  const { t } = useI18n();
  const motivation = getMotivationalMessage({
    openCount: counts.open,
    doneCount: counts.done,
    overdueCount: counts.overdue,
    streak: counts.streak,
  });

  return (
    <>
      <p className={cn("today-hero-headline", motivation.badgeType)}>
        {motivation.emoji}{" "}
        {t(motivation.titleKey as TranslationKey, motivation.params)}
      </p>
      <p className="today-hero-subtitle">
        {t(motivation.subtitleKey as TranslationKey, {
          ...motivation.params,
          streak: motivation.streakDays
            ? t("motivStreakSuffix", { n: motivation.streakDays })
            : "",
        })}
      </p>
    </>
  );
}

function HeroStats({ counts }: { counts: TodayCounts }) {
  const { t } = useI18n();
  const dot = <span className="today-hero-stat-dot">•</span>;

  return (
    <div className="today-hero-quickstats">
      <span className="today-hero-stat">
        <strong>{counts.open}</strong> {t("todayOpen")}
      </span>
      {dot}
      <span className="today-hero-stat">
        <strong>{counts.done}</strong> {t("todayDone")}
      </span>
      {counts.focusedSec > 0 ? (
        <>
          {dot}
          <span className="today-hero-stat">
            <strong>{formatTracked(counts.focusedSec)}</strong>{" "}
            {t("todayFocusedStat")}
          </span>
        </>
      ) : null}
      {counts.overdue > 0 ? (
        <>
          {dot}
          <span className="today-hero-stat danger">
            <strong>{counts.overdue}</strong> {t("todayOverdueStat")}
          </span>
        </>
      ) : null}
      {counts.streak > 0 ? (
        <>
          {dot}
          <span
            className="today-hero-stat streak"
            title={t("todayStreakBadge", { n: counts.streak })}
          >
            <Flame size={11} aria-hidden />
            <strong>{counts.streak}</strong> {t("todayStreakUnit")}
          </span>
        </>
      ) : null}
    </div>
  );
}
