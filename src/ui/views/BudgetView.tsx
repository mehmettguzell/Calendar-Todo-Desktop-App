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
  fixedCostsInRange,
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
import { openWishlist } from "@/domain/wishlist";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useNow, useStore } from "@/state/store";
import { useViewPrefs, type BudgetTab } from "@/state/viewPrefsStore";
import { EmptyArt } from "@/ui/components/EmptyArt";
import { Empty } from "@/ui/components/primitives";
import { Segmented } from "@/ui/components/Segmented";
import { FixedCosts } from "@/ui/budget/FixedCosts";
import { Ledger } from "@/ui/budget/Ledger";
import { SpendingBreakdown } from "@/ui/budget/SpendingBreakdown";
import { StatementImport } from "@/ui/budget/StatementImport";
import {
  ImportedStatements,
  statementsInRange,
} from "@/ui/budget/ImportedStatements";
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
 * **Two questions, in this order, and never more than one at a time.**
 *
 * *Which stretch of time?* — the top row, and nothing else: back, forward,
 * today, and how long a window. It is the one control that changes the meaning
 * of every number under it, so it sits above everything and stays put.
 *
 * *Which question about that time?* — the tab strip, five answers:
 *
 *  1. **Özet** — where do I stand, and where did it go.
 *  2. **İşlemler** — what exactly happened, entry by entry.
 *  3. **Ekstreler** — what did the bank file add, and how do I take it back.
 *  4. **Sabit gelir/gider** — what comes round every period regardless.
 *  5. **Alınacaklar** — what I mean to buy, which is not money that has moved.
 *
 * The page used to answer all five at once, down one scroll: the wishlist,
 * then four totals, then the statements, then the entry form, then the
 * standing bills, then the breakdown, then the ledger. Three tab strips and
 * two forms were on screen simultaneously, each filtering something different,
 * and the only way to tell which strip drove which panel was to press one and
 * watch what moved. No single piece of it was wrong. There was simply no
 * moment at which the page was asking you one thing.
 *
 * The tabs are a sequence, not a filing cabinet: you land on the summary and
 * reach for a tab when the summary raises a question. Which one you were last
 * on outlives the view (`viewPrefsStore`) — coming back from Today to a page
 * you had already navigated is the app undoing a choice you just made.
 *
 * Nothing here is a second copy of anything. Every tab reads the same
 * transactions over the same range; the split is in the asking, not the data.
 */
export function BudgetView() {
  const { t } = useI18n();
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
    () =>
      periodRange(
        stepPeriod(anchor, period, -1),
        period,
        settings.weekStartsOn,
      ),
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
  const wishlistOpen = useMemo(() => openWishlist(wishlist), [wishlist]);

  const [breakdownFlow, setBreakdownFlow] = useState<MoneyFlow>("EXPENSE");
  const breakdown = useMemo(
    () => totalsByCategory(rows, breakdownFlow),
    [rows, breakdownFlow],
  );

  return (
    <div className="page wide budget">
      {/* Which stretch of time. One row, one job — every number below it is
          measured against whatever this says. */}
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

        {/* The one figure that stays on screen whichever tab is open: am I up
            or down, which is why anybody opened the page. The four cards that
            explain it live on Özet, where there is room to name them. */}
        <span
          className={cn(
            "budget-range-net mono",
            totals.net >= 0 ? "is-positive" : "is-negative",
          )}
          title={totals.net >= 0 ? t("budgetSurplus") : t("budgetDeficit")}
        >
          {totals.net >= 0 ? "+" : "−"}
          {formatMoney(Math.abs(totals.net), currency)}
        </span>

        <button
          type="button"
          className="btn sm"
          onClick={() => setAnchor(today)}
        >
          {t("today")}
        </button>

        <span className="grow" />

        <Segmented
          size="sm"
          ariaLabel={t("budgetPeriodAria")}
          value={period}
          onChange={setPeriod}
          segments={PERIODS.map((p) => ({ id: p.id, label: t(p.labelKey) }))}
        />
      </header>

      {/* Which question about it. */}
      <nav className="budget-tabbar section">
        <Segmented<BudgetTab>
          ariaLabel={t("budgetTabsAria")}
          value={tab}
          onChange={setTab}
          segments={[
            { id: "overview", label: t("budgetTabOverview") },
            {
              id: "entries",
              label: t("budgetTabEntries"),
              count: rows.length,
            },
            {
              id: "statements",
              label: t("budgetTabStatements"),
              count: statements.length,
            },
            {
              id: "fixed",
              label: t("budgetTabFixed"),
              count: fixedRows.length,
            },
            {
              id: "wishlist",
              label: t("budgetTabWishlist"),
              count: wishlistOpen.length,
            },
          ]}
        />

        <span className="grow" />

        {/* Loading a statement acts on the whole window rather than on any one
            panel, so it stays reachable from every tab. */}
        <button
          type="button"
          className="btn sm"
          onClick={() => setImportOpen(true)}
        >
          <FileUp size={13} /> {t("importButton")}
        </button>
      </nav>

      {tab === "overview" ? (
        <>
          <p className="budget-tab-hint section">{t("budgetOverviewHint")}</p>

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

          <QuickEntry defaultDate={clampToRange(today, range)} autoFocus />

          {generated > 0 ? (
            <p className="budget-generated-note section">
              {generated} {t("budgetGeneratedCount")}
            </p>
          ) : null}

          <section className="card budget-breakdown section">
            <div className="section-head">
              <h3>{t("budgetWhereItWent")}</h3>
              <span className="grow" />
              <Segmented<MoneyFlow>
                size="sm"
                ariaLabel={t("budgetWhereItWent")}
                value={breakdownFlow}
                onChange={setBreakdownFlow}
                segments={MONEY_FLOWS.map((flow) => ({
                  id: flow,
                  label: t(FLOW_LABEL[flow]),
                }))}
              />
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
                    <li
                      key={row.categoryId ?? "none"}
                      className="budget-bar-row"
                    >
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
        </>
      ) : null}

      {tab === "entries" ? (
        <>
          <QuickEntry defaultDate={clampToRange(today, range)} />
          <div className="section">
            <Ledger
              rows={rows}
              categories={categories}
              currency={currency}
              today={today}
            />
          </div>
        </>
      ) : null}

      {tab === "statements" ? (
        statements.length === 0 ? (
          <Empty
            icon={<EmptyArt kind="notes" />}
            title={t("statementsEmpty")}
            hint={t("budgetStatementsHint")}
            action={
              <button
                type="button"
                className="btn primary"
                onClick={() => setImportOpen(true)}
              >
                <FileUp size={14} /> {t("importButton")}
              </button>
            }
          />
        ) : (
          <>
            <p className="budget-tab-hint section">
              {t("budgetStatementsHint")}
            </p>
            <ImportedStatements range={range} currency={currency} />
          </>
        )
      ) : null}

      {/* Next along from the statements, and out of the month's own flow.
          The standing bills used to sit between the totals and the breakdown:
          the plan for the month printed in the middle of the account of what
          the month actually did. */}
      {tab === "fixed" ? (
        // No line of explanation above it: the panel carries its own, and
        // saying the same thing twice a centimetre apart is how a page starts
        // reading as noise.
        <div className="section">
          <FixedCosts range={range} today={today} currency={currency} />
        </div>
      ) : null}

      {tab === "wishlist" ? (
        <>
          <p className="budget-tab-hint section">{t("budgetWishlistHint")}</p>
          <Wishlist currency={currency} />
        </>
      ) : null}

      {importOpen ? (
        <StatementImport onClose={() => setImportOpen(false)} />
      ) : null}
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
function QuickEntry({
  defaultDate,
  autoFocus = false,
}: {
  defaultDate: string;
  /**
   * Put the cursor in the amount box on mount.
   *
   * Only the summary asks for it. Both tabs that carry this form would
   * otherwise grab the caret every time somebody switched to them, which on a
   * page you are reading rather than typing into is the screen taking the
   * keyboard away from you.
   */
  autoFocus?: boolean;
}) {
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
    if (autoFocus) amountRef.current?.focus();
  }, [autoFocus]);

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
    /*
     * The one form on the page, and it says so.
     *
     * It used to be a bare row of six inputs floating between two panels, with
     * a three-way strip on its left that looked exactly like the two other
     * three-way strips above and below it — so which of them this row was
     * filtered by was a guess. Inside a card with a heading, the strip is
     * plainly one of *its* fields.
     */
    <section className="card budget-entry-card section">
      <div className="section-head">
        <h3>{t("budgetAddHeading")}</h3>
      </div>

      <form className="budget-entry" onSubmit={submit}>
        <div className="segmented-tabs is-sm">
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
    </section>
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
function clampToRange(
  date: string,
  range: { from: string; to: string },
): string {
  if (date < range.from) return range.from;
  if (date > range.to) return range.to;
  return date;
}

const LIMIT_COLOURS = {
  ok: "#22c55e",
  close: "#eab308",
  over: "#ef4444",
} as const;
