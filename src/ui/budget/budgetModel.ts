import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDate, toLocalDate } from "@/domain/datetime";
import {
  burnRatePerDay,
  fixedCostsInRange,
  periodRange,
  stepPeriod,
  summarise,
  totalsByCategory,
  transactionsInRange,
  type MoneyFlow,
  type Transaction,
} from "@/domain/money";
import { openWishlist } from "@/domain/wishlist";
import type { TranslationKey } from "@/lib/i18n";
import { useNow, useStore } from "@/state/store";
import { useViewPrefs } from "@/state/viewPrefsStore";
import { statementsInRange } from "./ImportedStatements";

export type PeriodId = "day" | "week" | "month" | "year";

export const PERIODS: { id: PeriodId; labelKey: TranslationKey }[] = [
  { id: "day", labelKey: "budgetDay" },
  { id: "week", labelKey: "budgetWeek" },
  { id: "month", labelKey: "budgetMonth" },
  { id: "year", labelKey: "budgetYear" },
];

/** Everything the budget page reads, over one window of time. */
/* eslint-disable-next-line max-lines-per-function -- one window, every figure drawn from it */
export function useBudgetView() {
  const now = useNow();
  const settings = useStore((s) => s.db.settings);
  const transactions = useStore((s) => s.db.transactions);
  const categories = useStore((s) => s.db.budgetCategories);
  const statementBatches = useStore((s) => s.db.statementBatches);
  const wishlist = useStore((s) => s.db.wishlist);
  const updateBudgetCategory = useStore((s) => s.updateBudgetCategory);
  const materialise = useStore((s) => s.materialiseRecurringTransactions);

  const [generated, setGenerated] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  /*
   * The entry that was just typed, and the one the ledger should open.
   *
   * The form is on Özet and the row it writes is on İşlemler, so without these
   * an amount typed wrong five seconds ago can only be corrected by knowing
   * which tab it went to. The receipt below the form is the way back.
   */
  const [justAdded, setJustAdded] = useState<Transaction | null>(null);
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [breakdownFlow, setBreakdownFlow] = useState<MoneyFlow>("EXPENSE");

  const tab = useViewPrefs((s) => s.budgetTab);
  const setTab = useViewPrefs((s) => s.setBudgetTab);

  const currency = settings.currency ?? "TRY";
  const today = toLocalDate(now);
  const [period, setPeriod] = useState<PeriodId>("month");
  const [anchor, setAnchor] = useState(() => today);

  const range = useMemo(
    () => periodRange(anchor, period, settings.weekStartsOn),
    [anchor, period, settings.weekStartsOn],
  );

  /*
   * The window immediately before this one, of the same length.
   *
   * Stepping back by the period rather than subtracting days keeps "August vs
   * July" meaning August vs July even though one of them is a day shorter.
   */
  const previousRange = useMemo(
    () => periodRange(stepPeriod(anchor, period, -1), period, settings.weekStartsOn),
    [anchor, period, settings.weekStartsOn],
  );

  const rows = useMemo(
    () => transactionsInRange(transactions, range),
    [transactions, range],
  );

  // Catch up on repeating entries whenever the view is opened. The app may
  // have been closed for a month; the answer has to be the same either way.
  useEffect(() => {
    setGenerated(materialise(today));
  }, [materialise, today]);

  /*
   * What sits behind each tab, counted where the tab is drawn.
   *
   * A strip with no numbers on it has to be clicked four times to find out
   * whether any of them holds anything — and "nothing was imported this month"
   * is a real answer that should not cost a navigation to get.
   */
  const statements = useMemo(
    () => statementsInRange(statementBatches, range),
    [statementBatches, range],
  );
  const fixedRows = useMemo(
    () => fixedCostsInRange(transactions, range, today),
    [transactions, range, today],
  );

  return {
    transactions,
    categories,
    categoryById: useMemo(
      () => new Map(categories.map((c) => [c.id, c])),
      [categories],
    ),
    currency,
    today,
    period,
    setPeriod,
    anchor,
    setAnchor,
    range,
    previousRange,
    rows,
    totals: useMemo(() => summarise(rows), [rows]),
    burn: useMemo(() => burnRatePerDay(rows, range), [rows, range]),
    statements,
    fixedRows,
    wishlistOpen: useMemo(() => openWishlist(wishlist), [wishlist]),
    breakdown: useMemo(
      () => totalsByCategory(rows, breakdownFlow),
      [rows, breakdownFlow],
    ),
    breakdownFlow,
    setBreakdownFlow,
    generated,
    tab,
    setTab,
    importOpen,
    setImportOpen,
    justAdded,
    setJustAdded,
    focusEntryId,
    // Stable, so the ledger's effect does not re-run on every render of this page.
    clearFocusEntry: useCallback(() => setFocusEntryId(null), []),
    openEntry: (entry: Transaction) => {
      setFocusEntryId(entry.id);
      setJustAdded(null);
      setTab("entries");
    },
    updateBudgetCategory,
  };
}

export type BudgetModel = ReturnType<typeof useBudgetView>;

export function describeRange(
  range: { from: string; to: string },
  period: PeriodId,
): string {
  if (period === "day") return formatDate(range.from, "d MMMM yyyy");
  if (period === "month") return formatDate(range.from, "MMMM yyyy");
  if (period === "year") return formatDate(range.from, "yyyy");
  return `${formatDate(range.from, "d MMM")} – ${formatDate(range.to, "d MMM yyyy")}`;
}

/** Default a new entry to today, unless today sits outside the window shown. */
export function clampToRange(
  date: string,
  range: { from: string; to: string },
): string {
  if (date < range.from) return range.from;
  if (date > range.to) return range.to;
  return date;
}
