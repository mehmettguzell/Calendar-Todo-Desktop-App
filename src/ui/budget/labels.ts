import type { MoneyFlow } from "@/domain/money";
import type { LocalDate, Recurrence, RecurrenceFreq } from "@/domain/types";
import type { TranslationKey } from "@/lib/i18n";

// The words and colours the budget screens share, in one place so the ledger,
// the fixed-cost editor and the breakdown cannot drift apart on them.

export const FLOW_LABEL: Record<MoneyFlow, TranslationKey> = {
  EXPENSE: "budgetExpense",
  INCOME: "budgetIncome",
  INVESTMENT: "budgetInvestment",
};

export const CADENCES: { freq: RecurrenceFreq; labelKey: TranslationKey }[] = [
  { freq: "MONTHLY", labelKey: "budgetRepeatMonthly" },
  { freq: "WEEKLY", labelKey: "budgetRepeatWeekly" },
  { freq: "YEARLY", labelKey: "budgetRepeatYearly" },
];

/** Where an entry came from: typed by hand, from an alert, or from a statement. */
export const ORIGIN_LABEL = {
  manual: "ledgerOriginManual",
  alert: "ledgerOriginAlert",
  statement: "ledgerOriginStatement",
} as const;

/**
 * "Her ayın 5. günü" — the sentence, not the rule.
 *
 * Short enough to sit on one line of a row, which is why it does not reach for
 * `describeRecurrence`: that one is written for a task panel with room for
 * "every 2 weeks on Monday, Wednesday until 3 March".
 */
export function describeCadence(
  rule: Recurrence | null | undefined,
  anchor: LocalDate,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!rule) return "";
  if (rule.freq === "WEEKLY") return t("budgetRepeatWeekly");
  if (rule.freq === "YEARLY") return t("budgetRepeatYearly");
  if (rule.freq !== "MONTHLY") return t("budgetRepeatMonthly");
  if (rule.byMonthDay === -1) return t("fixedMonthlyLast");
  const day = rule.byMonthDay ?? Number(anchor.slice(8, 10));
  return t("fixedMonthlyOn", { day });
}

/** How a category stands against its own ceiling. */
export const LIMIT_COLOURS = {
  ok: "#22c55e",
  close: "#eab308",
  over: "#ef4444",
} as const;
