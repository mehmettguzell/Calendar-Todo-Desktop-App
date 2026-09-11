// What the header says about the day. Pure: it reads the day's numbers and picks
// a phrase, so the copy lives in i18n and the choosing lives here.

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

/** Something is wrong, or there is nothing to be wrong about. */
function attentionMessage(
  options: MotivationOptions,
  total: number,
): MotivationalMessage | null {
  const { openCount, overdueCount, currentHour = 0 } = options;

  if (overdueCount > 0 && openCount > 0) {
    return {
      titleKey: "motivOverdueTitle",
      subtitleKey: "motivOverdueSub",
      params: { n: overdueCount },
      emoji: "⚡",
      badgeType: "warning",
    };
  }
  if (total > 0) return null;
  return currentHour < 12
    ? {
        titleKey: "motivMorningEmptyTitle",
        subtitleKey: "motivMorningEmptySub",
        emoji: "☀️",
        badgeType: "neutral",
      }
    : {
        titleKey: "motivEmptyTitle",
        subtitleKey: "motivEmptySub",
        emoji: "🛋️",
        badgeType: "neutral",
      };
}

/** How far through the day's list, once there is a list. */
function completionMessage(
  options: MotivationOptions,
  total: number,
  percent: number,
): MotivationalMessage | null {
  const { openCount, doneCount, streak } = options;

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
  return null;
}

/** Nothing done yet: the nudge depends only on what time it is. */
function timeOfDayMessage(
  openCount: number,
  currentHour: number,
): MotivationalMessage {
  const params = { open: openCount };
  if (currentHour < 12) {
    return {
      titleKey: "motivMorningTitle",
      subtitleKey: "motivMorningSub",
      params,
      emoji: "🚀",
      badgeType: "neutral",
    };
  }
  if (currentHour >= 18) {
    return {
      titleKey: "motivEveningTitle",
      subtitleKey: "motivEveningSub",
      params,
      emoji: "💡",
      badgeType: "neutral",
    };
  }
  return {
    titleKey: "motivFocusTitle",
    subtitleKey: "motivFocusSub",
    params,
    emoji: "⏳",
    badgeType: "neutral",
  };
}

export function getMotivationalMessage(
  options: MotivationOptions,
): MotivationalMessage {
  const hour = options.currentHour ?? new Date().getHours();
  const total = options.openCount + options.doneCount;
  const percent = total === 0 ? 100 : Math.round((options.doneCount / total) * 100);

  // Order is the meaning: something overdue outranks good progress, and an
  // empty list is a different state from a finished one.
  const withHour = { ...options, currentHour: hour };
  return (
    attentionMessage(withHour, total) ??
    completionMessage(withHour, total, percent) ??
    timeOfDayMessage(options.openCount, hour)
  );
}
