import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileUp,
  PiggyBank,
  Plus,
  Wallet,
} from "lucide-react";
import { formatDate, toLocalDate } from "@/domain/datetime";
import {
  accountNames,
  burnRatePerDay,
  formatMoney,
  limitStatus,
  MONEY_FLOWS,
  parseAmount,
  periodRange,
  stepPeriod,
  summarise,
  totalsByCategory,
  transactionsInRange,
  type BudgetCategory,
  type MoneyFlow,
} from "@/domain/money";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useNow, useStore } from "@/state/store";
import { FixedCosts } from "@/ui/budget/FixedCosts";
import { Ledger } from "@/ui/budget/Ledger";
import { SpendingBreakdown } from "@/ui/budget/SpendingBreakdown";
import { StatementImport } from "@/ui/budget/StatementImport";
import { ImportedStatements } from "@/ui/budget/ImportedStatements";
import { Wishlist } from "@/ui/budget/Wishlist";

type PeriodId = "day" | "week" | "month" | "year";

const PERIODS: { id: PeriodId; labelKey: TranslationKey }[] = [
  { id: "day", labelKey: "budgetDay" },
  { id: "week", labelKey: "budgetWeek" },
  { id: "month", labelKey: "budgetMonth" },
  { id: "year", labelKey: "budgetYear" },
];

const FLOW_LABEL: Record<MoneyFlow, TranslationKey> = {
  INCOME: "budgetIncome",
  EXPENSE: "budgetExpense",
  INVESTMENT: "budgetInvestment",
};

/**
 * Budget: the same calendar, viewed in money.
 *
 * Four questions, in the order they are actually asked, each answered exactly
 * once:
 *
 *  1. Where do I stand? — the four totals across the top.
 *  2. Where did it go? — one breakdown, category down to shop.
 *  3. What comes round every month regardless? — the fixed entries.
 *  4. What exactly happened? — the ledger, by day.
 *
 * The "exactly once" is the part that had gone wrong. Two panels used to draw
 * category totals side by side under two different headings, so the same
 * ₺8.400 of groceries appeared twice and the ledger underneath led with the
 * category name as well — three views of the grouping and none of the events.
 */
export function BudgetView() {
  const { t } = useI18n();
  const now = useNow();
  const settings = useStore((s) => s.db.settings);
  const transactions = useStore((s) => s.db.transactions);
  const categories = useStore((s) => s.db.budgetCategories);
  const updateBudgetCategory = useStore((s) => s.updateBudgetCategory);
  const materialise = useStore((s) => s.materialiseRecurringTransactions);
  const [generated, setGenerated] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  const currency = settings.currency ?? "TRY";
  const today = toLocalDate(now);
  const [period, setPeriod] = useState<PeriodId>("month");
  const [anchor, setAnchor] = useState(() => today);

  const range = useMemo(
    () => periodRange(anchor, period, settings.weekStartsOn),
    [anchor, period, settings.weekStartsOn],
  );

  const rows = useMemo(
    () => transactionsInRange(transactions, range),
    [transactions, range],
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
  const totals = useMemo(() => summarise(rows), [rows]);
  const burn = useMemo(() => burnRatePerDay(rows, range), [rows, range]);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  // Catch up on repeating entries whenever the view is opened. The app may
  // have been closed for a month; the answer has to be the same either way.
  useEffect(() => {
    setGenerated(materialise(today));
    // Only on mount and when the calendar day rolls over.
  }, [materialise, today]);

  const [breakdownFlow, setBreakdownFlow] = useState<MoneyFlow>("EXPENSE");
  const breakdown = useMemo(
    () => totalsByCategory(rows, breakdownFlow),
    [rows, breakdownFlow],
  );

  return (
    <div className="page wide budget">
      <header className="budget-bar section">
        <div className="row" style={{ gap: 2 }}>
          <button
            type="button"
            className="btn ghost icon"
            aria-label={t("previous")}
            onClick={() => setAnchor(stepPeriod(anchor, period, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            aria-label={t("next")}
            onClick={() => setAnchor(stepPeriod(anchor, period, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <h2 className="budget-range">{describeRange(range, period)}</h2>

        <button
          type="button"
          className="btn sm"
          onClick={() => setAnchor(today)}
        >
          {t("today")}
        </button>

        <span className="grow" />

        <div className="segmented">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        {/* Importing a statement belongs with the period controls, not buried
            in a panel header: it is a thing you do to the whole window. */}
        <button
          type="button"
          className="btn sm"
          onClick={() => setImportOpen(true)}
        >
          <FileUp size={13} /> {t("importButton")}
        </button>
      </header>

      <Wishlist currency={currency} />

      <section className="budget-totals section">
        <StatCard
          tone="income"
          icon={<ArrowUpRight size={16} />}
          label={t("budgetIncome")}
          value={formatMoney(totals.income, currency)}
        />
        <StatCard
          tone="expense"
          icon={<ArrowDownRight size={16} />}
          label={t("budgetExpense")}
          value={formatMoney(totals.expense, currency)}
        />
        <StatCard
          tone="investment"
          icon={<PiggyBank size={16} />}
          label={t("budgetInvestment")}
          value={formatMoney(totals.investment, currency)}
        />
        <StatCard
          tone={totals.net >= 0 ? "positive" : "negative"}
          icon={<Wallet size={16} />}
          label={totals.net >= 0 ? t("budgetSurplus") : t("budgetDeficit")}
          value={formatMoney(Math.abs(totals.net), currency)}
          hint={`${t("budgetPerDay")} ${formatMoney(burn, currency)}`}
          emphasis
        />
      </section>

      <ImportedStatements range={range} currency={currency} />

      <QuickEntry defaultDate={clampToRange(today, range)} />

      {generated > 0 ? (
        <p className="budget-generated-note section">
          {generated} {t("budgetGeneratedCount")}
        </p>
      ) : null}

      <div className="budget-columns section">
        <section className="card budget-breakdown">
          <div className="section-head">
            <h3>{t("budgetWhereItWent")}</h3>
            <div className="segmented sm">
              {MONEY_FLOWS.map((flow) => (
                <button
                  key={flow}
                  type="button"
                  aria-pressed={breakdownFlow === flow}
                  onClick={() => setBreakdownFlow(flow)}
                >
                  {t(FLOW_LABEL[flow])}
                </button>
              ))}
            </div>
          </div>

          {/*
            Spending gets the full tree — category, then the shops inside it,
            then the comparison against last month — because that is the flow
            with a decision attached to it. Income and investment get plain
            bars: "where exactly did the salary come from" is not a question
            anybody has.
          */}
          {breakdownFlow === "EXPENSE" ? (
            <SpendingBreakdown
              transactions={transactions}
              categories={categories}
              range={range}
              previousRange={previousRange}
              currency={currency}
              onSetLimit={(categoryId, minor) =>
                updateBudgetCategory(categoryId, { monthlyLimitMinor: minor })
              }
            />
          ) : breakdown.length === 0 ? (
            <p className="faint">{t("budgetNothingYet")}</p>
          ) : (
            <ul className="budget-bars">
              {breakdown.map((row) => {
                const category = row.categoryId
                  ? (categoryById.get(row.categoryId) ?? null)
                  : null;
                const limit = limitStatus(
                  category?.monthlyLimitMinor,
                  row.amountMinor,
                );
                return (
                  <li key={row.categoryId ?? "none"} className="budget-bar-row">
                    <span className="budget-bar-label truncate">
                      <span aria-hidden>{category?.icon ?? "•"}</span>
                      {category?.name ?? t("budgetUncategorised")}
                    </span>
                    <span className="budget-bar-track">
                      <span
                        className="budget-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(2, (limit ? limit.ratio : row.share) * 100))}%`,
                          background: limit
                            ? LIMIT_COLOURS[limit.state]
                            : (category?.color ?? "var(--text-faint)"),
                        }}
                      />
                    </span>
                    <span className="budget-bar-value mono">
                      {formatMoney(row.amountMinor, currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FixedCosts range={range} today={today} currency={currency} />
      </div>

      {/* Full width, and last: the ledger is what you drop into once the three
          answers above have told you which day to look at. */}
      <div className="section">
        <Ledger
          rows={rows}
          categories={categories}
          currency={currency}
          today={today}
        />
      </div>

      {importOpen ? <StatementImport onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function StatCard({
  tone,
  icon,
  label,
  value,
  hint,
  emphasis,
}: {
  tone: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("budget-stat", tone, emphasis && "emphasis")}>
      <span className="budget-stat-icon" aria-hidden>
        {icon}
      </span>
      <span className="budget-stat-label">{label}</span>
      <span className="budget-stat-value">{value}</span>
      {hint ? <span className="budget-stat-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * One row, always visible: amount, what it was, when.
 *
 * The category field is a free-text input backed by a datalist rather than a
 * fixed dropdown — picking an existing label is one keystroke, and typing a new
 * one adds it permanently instead of forcing a detour into settings.
 *
 * There is no repeat picker here any more. A standing charge is not something
 * you log; it is something you set up once, and it now has a panel of its own
 * where it can also be seen, corrected and stopped. Leaving a duplicate of it
 * in the quick-entry row bought a seventh field on the one row in the view that
 * has to stay fast.
 */
function QuickEntry({ defaultDate }: { defaultDate: string }) {
  const { t } = useI18n();
  const addTransaction = useStore((s) => s.addTransaction);
  const ensureBudgetCategory = useStore((s) => s.ensureBudgetCategory);
  const categories = useStore((s) => s.db.budgetCategories);

  const transactions = useStore((s) => s.db.transactions);

  const [amount, setAmount] = useState("");
  const [flow, setFlow] = useState<MoneyFlow>("EXPENSE");
  const [categoryName, setCategoryName] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const suggestions = categories.filter((c) => c.flow === flow);
  const cards = useMemo(() => accountNames(transactions), [transactions]);

  /*
   * The cursor starts in the amount box.
   *
   * The view exists to answer "where do I stand", but the reason someone opens
   * it in a hurry is to put a number in — and a number that costs a click to
   * start typing is a number that gets typed later, or not at all.
   */
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const amountMinor = parseAmount(amount);
    if (amountMinor === null || amountMinor === 0) {
      setError(t("budgetAmountInvalid"));
      return;
    }

    const category: BudgetCategory | null = categoryName.trim()
      ? ensureBudgetCategory(categoryName, flow)
      : null;

    addTransaction({
      date,
      amountMinor,
      flow,
      categoryId: category?.id ?? null,
      note,
      account,
    });

    setAmount("");
    setNote("");
    setError(null);
    // The card is almost always the same one twice running; the amount never
    // is. Keeping it saves a field on every entry after the first.
    amountRef.current?.focus();
  };

  return (
    <form className="budget-entry section" onSubmit={submit}>
      <div className="segmented sm">
        {MONEY_FLOWS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={flow === f}
            onClick={() => setFlow(f)}
          >
            {t(FLOW_LABEL[f])}
          </button>
        ))}
      </div>

      <input
        ref={amountRef}
        className="input budget-amount"
        inputMode="decimal"
        placeholder={t("budgetAmount")}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setError(null);
        }}
        aria-invalid={error !== null}
      />

      <input
        className="input budget-category"
        list="budget-category-options"
        placeholder={t("budgetCategory")}
        value={categoryName}
        onChange={(e) => setCategoryName(e.target.value)}
      />
      <datalist id="budget-category-options">
        {suggestions.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      <input
        className="input budget-note"
        placeholder={t("budgetNote")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <input
        className="input budget-account"
        list="budget-account-options"
        placeholder={t("budgetAccount")}
        aria-label={t("budgetAccount")}
        value={account}
        onChange={(e) => setAccount(e.target.value)}
      />
      <datalist id="budget-account-options">
        {cards.map((card) => (
          <option key={card} value={card} />
        ))}
      </datalist>

      <input
        className="input budget-date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />

      <button type="submit" className="btn primary">
        <Plus size={15} /> {t("add")}
      </button>

      {error ? <span className="budget-entry-error">{error}</span> : null}
    </form>
  );
}

function describeRange(
  range: { from: string; to: string },
  period: PeriodId,
): string {
  if (period === "day") return formatDate(range.from, "d MMMM yyyy");
  if (period === "month") return formatDate(range.from, "MMMM yyyy");
  if (period === "year") return formatDate(range.from, "yyyy");
  return `${formatDate(range.from, "d MMM")} – ${formatDate(range.to, "d MMM yyyy")}`;
}

/** Default a new entry to today, unless today sits outside the window shown. */
function clampToRange(date: string, range: { from: string; to: string }): string {
  if (date < range.from) return range.from;
  if (date > range.to) return range.to;
  return date;
}

const LIMIT_COLOURS = {
  ok: "#22c55e",
  close: "#eab308",
  over: "#ef4444",
} as const;
