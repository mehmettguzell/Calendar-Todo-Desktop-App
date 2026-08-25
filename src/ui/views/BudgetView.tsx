import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileUp,
  PiggyBank,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { formatDate, toLocalDate } from "@/domain/datetime";
import { fold } from "@/domain/merchant";
import {
  accountNames,
  burnRatePerDay,
  isProvisional,
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
import type { Recurrence } from "@/domain/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useNow, useStore } from "@/state/store";
import { SpendingBreakdown } from "@/ui/budget/SpendingBreakdown";
import { StatementImport } from "@/ui/budget/StatementImport";
import { SpendFeedReview } from "@/ui/budget/SpendFeedReview";

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
 * One question drives the layout — "where do I stand this month?" — so the
 * answer is the first thing on screen, the breakdown that explains it comes
 * second, and the raw ledger comes last. Entry is a single row rather than a
 * modal: a spend logged three taps later is a spend that does not get logged.
 */
export function BudgetView() {
  const { t } = useI18n();
  const now = useNow();
  const settings = useStore((s) => s.db.settings);
  const transactions = useStore((s) => s.db.transactions);
  const categories = useStore((s) => s.db.budgetCategories);
  const deleteTransaction = useStore((s) => s.deleteTransaction);
  const updateBudgetCategory = useStore((s) => s.updateBudgetCategory);
  const materialise = useStore((s) => s.materialiseRecurringTransactions);
  const [generated, setGenerated] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  const currency = settings.currency ?? "TRY";
  const [period, setPeriod] = useState<PeriodId>("month");
  const [anchor, setAnchor] = useState(() => toLocalDate(now));

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
    setGenerated(materialise(toLocalDate(now)));
    // Only on mount and when the calendar day rolls over.
  }, [materialise, toLocalDate(now)]);

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
          onClick={() => setAnchor(toLocalDate(now))}
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
      </header>

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

      <SpendFeedReview />

      <QuickEntry defaultDate={clampToRange(toLocalDate(now), range)} />

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

          {breakdown.length === 0 ? (
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
                          // Against the limit when there is one, against the
                          // biggest category when there is not: a bar measured
                          // against a ceiling answers a different question.
                          width: `${Math.min(100, Math.max(2, (limit ? limit.ratio : row.share) * 100))}%`,
                          background: limit
                            ? LIMIT_COLOURS[limit.state]
                            : (category?.color ?? "var(--text-faint)"),
                        }}
                      />
                    </span>
                    <span className="budget-bar-value mono">
                      {formatMoney(row.amountMinor, currency)}
                      {limit ? (
                        <span className={cn("budget-limit-note", limit.state)}>
                          {" / "}
                          {formatMoney(limit.limitMinor, currency)}
                        </span>
                      ) : null}
                    </span>
                    {category ? (
                      <LimitInput
                        category={category}
                        currency={currency}
                        onChange={(minor) =>
                          updateBudgetCategory(category.id, {
                            monthlyLimitMinor: minor,
                          })
                        }
                      />
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card budget-spend">
          <div className="section-head">
            <h3>{t("spendTitle")}</h3>
            <button
              type="button"
              className="btn sm"
              onClick={() => setImportOpen(true)}
            >
              <FileUp size={13} /> {t("importButton")}
            </button>
          </div>
          <SpendingBreakdown
            transactions={transactions}
            categories={categories}
            range={range}
            previousRange={previousRange}
            currency={currency}
          />
        </section>

        <section className="card budget-ledger">
          <div className="section-head">
            <h3>{t("budgetMovements")}</h3>
            <span className="faint" style={{ fontSize: 12 }}>
              {rows.length}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="faint">{t("budgetNothingYet")}</p>
          ) : (
            <ul className="budget-rows scroll">
              {rows.map((row) => {
                const category = row.categoryId
                  ? (categoryById.get(row.categoryId) ?? null)
                  : null;
                return (
                  <li key={row.id} className="budget-row">
                    <span className="budget-row-date mono">
                      {formatDate(row.date, "d MMM")}
                    </span>
                    <span
                      className="budget-row-icon"
                      style={{
                        background: `color-mix(in srgb, ${
                          category?.color ?? "var(--text-faint)"
                        } 18%, transparent)`,
                      }}
                      aria-hidden
                    >
                      {category?.icon ?? "•"}
                    </span>
                    <span className="budget-row-text truncate">
                      <span className="budget-row-title truncate">
                        {category?.name ?? t("budgetUncategorised")}
                      </span>
                      {row.note || row.recurrence || row.recurrenceSourceId ? (
                        <span className="budget-row-note truncate">
                          {row.recurrence ? `↻ ${t("budgetRepeating")} · ` : null}
                          {row.recurrenceSourceId ? `${t("budgetGenerated")} · ` : null}
                          {/* The shop, unless the note already says it — the
                              user who typed "migros" does not need "Migros ·
                              migros" read back to them. */}
                          {row.merchant && fold(row.merchant) !== fold(row.note)
                            ? `${row.merchant} · `
                            : null}
                          {row.note}
                        </span>
                      ) : null}
                    </span>
                    {/*
                      An entry no statement has confirmed yet. Worth a mark
                      rather than a footnote: it is the difference between a
                      number the bank has charged and one it has only announced.
                    */}
                    {isProvisional(row) ? (
                      <span className="spend-badge" title={t("spendProvisionalHint")}>
                        {t("spendProvisional")}
                      </span>
                    ) : (
                      // An empty cell rather than nothing: the ledger is a grid,
                      // and a column that appears only on some rows makes every
                      // amount below it sit in a different place.
                      <span />
                    )}
                    <span className={cn("budget-row-amount mono", row.flow.toLowerCase())}>
                      {row.flow === "INCOME" ? "+" : "−"}
                      {formatMoney(row.amountMinor, currency)}
                    </span>
                    <button
                      type="button"
                      className="btn ghost icon sm budget-row-delete"
                      aria-label={t("delete")}
                      onClick={() => deleteTransaction(row.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
  const [repeat, setRepeat] = useState<RepeatId>("none");
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
      recurrence: REPEAT_RULES[repeat],
    });

    setAmount("");
    setNote("");
    setRepeat("none");
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

      <select
        className="input budget-repeat"
        value={repeat}
        aria-label={t("budgetRepeat")}
        onChange={(e) => setRepeat(e.target.value as RepeatId)}
      >
        <option value="none">{t("budgetRepeatNone")}</option>
        <option value="monthly">{t("budgetRepeatMonthly")}</option>
        <option value="weekly">{t("budgetRepeatWeekly")}</option>
        <option value="yearly">{t("budgetRepeatYearly")}</option>
      </select>

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

type RepeatId = "none" | "weekly" | "monthly" | "yearly";

/** Rent is monthly; the other two are there because pay and insurance are not. */
const REPEAT_RULES: Record<RepeatId, Recurrence | null> = {
  none: null,
  weekly: { freq: "WEEKLY", interval: 1 },
  monthly: { freq: "MONTHLY", interval: 1 },
  yearly: { freq: "YEARLY", interval: 1 },
};

const LIMIT_COLOURS = {
  ok: "#22c55e",
  close: "#eab308",
  over: "#ef4444",
} as const;

/**
 * The monthly ceiling for one category, edited in place.
 *
 * Hidden until hovered when unset, so a view about where the money went does
 * not become a form. Committed on blur rather than per keystroke: a half-typed
 * "3" should not briefly mean a three-kuruş budget.
 */
function LimitInput({
  category,
  currency,
  onChange,
}: {
  category: BudgetCategory;
  currency: string;
  onChange: (minor: number | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);

  const current = category.monthlyLimitMinor ?? null;
  const shown =
    draft ?? (current ? String(Math.round(current / 100)) : "");

  return (
    <input
      className="budget-limit-input"
      inputMode="numeric"
      placeholder={t("budgetLimit")}
      title={`${t("budgetSetLimit")} (${currency})`}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const parsed = parseAmount(draft);
        onChange(draft.trim() === "" || parsed === null ? null : Math.abs(parsed));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
