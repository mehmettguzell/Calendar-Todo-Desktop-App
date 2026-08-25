import { minutesFromMidnight, toLocalDate } from "./datetime";
import { originOf, type Transaction } from "./money";
import type { LocalDate, LocalTime, Settings } from "./types";

/**
 * The end-of-day prompt to write down what was spent.
 *
 * The whole automatic feed still misses cash, and a card notification that
 * never arrived is invisible by definition. So the day closes with one
 * question — "is this everything?" — showing what the app already knows, which
 * is a far easier thing to answer than an empty box.
 *
 * The rule is deliberately once a day and never retroactive. A nudge that
 * fires twice is one the user turns off, and a nudge that fires at 09:00 for
 * yesterday is asking about a day nobody remembers any more.
 */

export const DEFAULT_SPEND_NUDGE_TIME: LocalTime = "21:00";

export function spendNudgeTime(settings: Settings): LocalTime {
  return settings.spendNudgeTime ?? DEFAULT_SPEND_NUDGE_TIME;
}

export function spendNudgeEnabled(settings: Settings): boolean {
  return settings.spendNudgeEnabled ?? true;
}

/**
 * Whether the day's prompt is owed right now.
 *
 * Owed, not "due at this instant": the app is closed most evenings at 21:00,
 * and a prompt that only fires if you happen to be looking is not a prompt.
 * Opening the laptop at 23:40 still gets today's question; opening it at 08:00
 * the next morning does not, because `lastNudgedOn` is compared against the day
 * that has since rolled over.
 */
export function spendNudgeDue(
  settings: Settings,
  now: Date = new Date(),
): boolean {
  if (!spendNudgeEnabled(settings)) return false;

  const today = toLocalDate(now);
  if (settings.lastSpendNudgeOn === today) return false;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= minutesFromMidnight(spendNudgeTime(settings));
}

export interface DaySpending {
  date: LocalDate;
  /** What went out: expenses plus investments. */
  outflowMinor: number;
  count: number;
  /** Entries still waiting for a statement to confirm them. */
  provisionalCount: number;
  entries: Transaction[];
}

/**
 * What the ledger already knows about one day.
 *
 * Shown beside the prompt so the question is "what is missing?" rather than
 * "what did you spend?" — the first is answerable from memory, the second is
 * the reason spending diaries get abandoned in week two.
 */
export function daySpending(
  transactions: Transaction[],
  date: LocalDate,
): DaySpending {
  const entries = transactions
    .filter((entry) => entry.deletedAt === null && entry.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let outflowMinor = 0;
  let provisionalCount = 0;
  for (const entry of entries) {
    if (entry.flow !== "INCOME") outflowMinor += entry.amountMinor;
    if (originOf(entry) !== "statement" && !entry.confirmedAt) provisionalCount += 1;
  }

  return {
    date,
    outflowMinor,
    count: entries.filter((entry) => entry.flow !== "INCOME").length,
    provisionalCount,
    entries,
  };
}
