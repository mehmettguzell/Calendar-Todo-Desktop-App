import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  PiggyBank,
  Wallet,
  X,
} from "lucide-react";
import {
  formatMoney,
  limitStatus,
  MONEY_FLOWS,
  type BudgetCategory,
  type MoneyFlow,
} from "@/domain/money";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { Segmented } from "@/ui/components/Segmented";
import { QuickEntry } from "./QuickEntry";
import { SpendingBreakdown } from "./SpendingBreakdown";
import { clampToRange, type BudgetModel } from "./budgetModel";
import { FLOW_LABEL, LIMIT_COLOURS } from "./labels";

/** Where do I stand, and where did it go. */
export function BudgetOverview({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();

  return (
    <>
      <p className="budget-tab-hint section">{t("budgetOverviewHint")}</p>

      <BudgetTotals model={m} />

      <QuickEntry
        defaultDate={clampToRange(m.today, m.range)}
        autoFocus
        onAdded={m.setJustAdded}
      />

      <AddedNote model={m} />

      {m.generated > 0 ? (
        <p className="budget-generated-note section">
          {m.generated} {t("budgetGeneratedCount")}
        </p>
      ) : null}

      <BudgetBreakdown model={m} />
    </>
  );
}

function BudgetTotals({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();
  const up = m.totals.net >= 0;

  return (
    <section className="budget-totals section">
      <StatCard
        tone="income"
        icon={<ArrowUpRight size={16} />}
        label={t("budgetIncome")}
        value={formatMoney(m.totals.income, m.currency)}
      />
      <StatCard
        tone="expense"
        icon={<ArrowDownRight size={16} />}
        label={t("budgetExpense")}
        value={formatMoney(m.totals.expense, m.currency)}
      />
      <StatCard
        tone="investment"
        icon={<PiggyBank size={16} />}
        label={t("budgetInvestment")}
        value={formatMoney(m.totals.investment, m.currency)}
      />
      <StatCard
        tone={up ? "positive" : "negative"}
        icon={<Wallet size={16} />}
        label={up ? t("budgetSurplus") : t("budgetDeficit")}
        value={formatMoney(Math.abs(m.totals.net), m.currency)}
        hint={`${t("budgetPerDay")} ${formatMoney(m.burn, m.currency)}`}
        emphasis
      />
    </section>
  );
}

/** The way back to an entry typed on this tab but filed on the next one. */
function AddedNote({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();
  const entry = m.justAdded;
  if (!entry) return null;

  return (
    <p className="budget-added-note section">
      <Check size={13} aria-hidden />
      <span className="truncate">
        {t("budgetAdded", {
          what: entry.note.trim() || entry.merchant?.trim() || t("budgetEntries"),
          amount: formatMoney(entry.amountMinor, m.currency),
        })}
      </span>
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => m.openEntry(entry)}
      >
        {t("edit")}
      </button>
      <button
        type="button"
        className="btn ghost icon sm"
        aria-label={t("cancel")}
        onClick={() => m.setJustAdded(null)}
      >
        <X size={13} />
      </button>
    </p>
  );
}

/**
 * Spending gets the full tree — category, then the shops inside it, then the
 * comparison against last month — because that is the flow with a decision
 * attached to it. Income and investment get plain bars: "where exactly did the
 * salary come from" is not a question anybody has.
 */
function BudgetBreakdown({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();

  return (
    <section className="card budget-breakdown section">
      <div className="section-head">
        <h3>{t("budgetWhereItWent")}</h3>
        <span className="grow" />
        <Segmented<MoneyFlow>
          size="sm"
          ariaLabel={t("budgetWhereItWent")}
          value={m.breakdownFlow}
          onChange={m.setBreakdownFlow}
          segments={MONEY_FLOWS.map((flow) => ({
            id: flow,
            label: t(FLOW_LABEL[flow]),
          }))}
        />
      </div>

      {m.breakdownFlow === "EXPENSE" ? (
        <SpendingBreakdown
          transactions={m.transactions}
          categories={m.categories}
          range={m.range}
          previousRange={m.previousRange}
          currency={m.currency}
          onSetLimit={(categoryId, minor) =>
            m.updateBudgetCategory(categoryId, { monthlyLimitMinor: minor })
          }
        />
      ) : (
        <FlowBars model={m} />
      )}
    </section>
  );
}

/** Income and investment, as one bar per category. */
function FlowBars({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();
  if (m.breakdown.length === 0) return <p className="faint">{t("budgetNothingYet")}</p>;

  return (
    <ul className="budget-bars">
      {m.breakdown.map((row) => (
        <FlowBar
          key={row.categoryId ?? "none"}
          row={row}
          category={
            row.categoryId ? (m.categoryById.get(row.categoryId) ?? null) : null
          }
          currency={m.currency}
        />
      ))}
    </ul>
  );
}

function FlowBar({
  row,
  category,
  currency,
}: {
  row: BudgetModel["breakdown"][number];
  category: BudgetCategory | null;
  currency: string;
}) {
  const { t } = useI18n();
  const limit = limitStatus(category?.monthlyLimitMinor, row.amountMinor);
  const ratio = limit ? limit.ratio : row.share;

  return (
    <li className="budget-bar-row">
      <span className="budget-bar-label truncate">
        <span aria-hidden>{category?.icon ?? "•"}</span>
        {category?.name ?? t("budgetUncategorised")}
      </span>
      <span className="budget-bar-track">
        <span
          className="budget-bar-fill"
          style={{
            width: `${Math.min(100, Math.max(2, ratio * 100))}%`,
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
