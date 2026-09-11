import { useMemo, useState } from "react";
import { Check, Clock3, Plus, Repeat2 } from "lucide-react";
import { formatDate } from "@/domain/datetime";
import { fold } from "@/domain/merchant";
import {
  fixedCostTotals,
  fixedCostsInRange,
  formatMoney,
  type BudgetCategory,
  type DateRange,
  type FixedCostRow,
} from "@/domain/money";
import type { LocalDate } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { FixedEditor } from "./FixedEditor";
import { describeCadence } from "./labels";

/**
 * The money that comes round on its own: rent, salary, the gym, insurance.
 *
 * This is the panel the ledger cannot be. An entry is only written when its day
 * arrives — deliberately, because a budget holding money it has not spent is
 * lying about where you stand — so a rent due on the 5th is invisible on the
 * 1st even though it is the most certain number in the month. This says what is
 * standing, what has already landed, and what is still to come.
 *
 * Editing one changes the template, which is what the *next* period is built
 * from. Periods already written keep the figure they were actually charged: a
 * rent rise in March must not silently rewrite January.
 */
export function FixedCosts({
  range,
  today,
  currency,
}: {
  range: DateRange;
  today: LocalDate;
  currency: string;
}) {
  const { t } = useI18n();
  const transactions = useStore((s) => s.db.transactions);
  const categories = useStore((s) => s.db.budgetCategories);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const rows = useMemo(
    () => fixedCostsInRange(transactions, range, today),
    [transactions, range, today],
  );
  const totals = useMemo(() => fixedCostTotals(rows), [rows]);
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  return (
    <section className="card budget-fixed">
      <div className="section-head">
        <h3>
          <Repeat2 size={15} aria-hidden /> {t("fixedTitle")}
        </h3>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            setEditingId(null);
            setAdding((open) => !open);
          }}
        >
          <Plus size={13} /> {t("fixedAdd")}
        </button>
      </div>

      <p className="faint fixed-hint">{t("fixedHint")}</p>

      {rows.length > 0 ? (
        <div className="fixed-totals">
          {totals.expense > 0 ? (
            <span className="fixed-total expense">
              <b className="mono">{formatMoney(totals.expense, currency)}</b>
              {t("fixedExpectedExpense")}
            </span>
          ) : null}
          {totals.investment > 0 ? (
            <span className="fixed-total investment">
              <b className="mono">{formatMoney(totals.investment, currency)}</b>
              {t("budgetInvestment")}
            </span>
          ) : null}
          {totals.income > 0 ? (
            <span className="fixed-total income">
              <b className="mono">{formatMoney(totals.income, currency)}</b>
              {t("fixedExpectedIncome")}
            </span>
          ) : null}
          {/* The number the panel exists for: what this period still owes. */}
          {totals.outstanding > 0 ? (
            <span className="fixed-total pending">
              <b className="mono">{formatMoney(totals.outstanding, currency)}</b>
              {t("fixedOutstanding")}
            </span>
          ) : null}
        </div>
      ) : null}

      {adding ? (
        <FixedEditor
          row={null}
          categories={categories}
          currency={currency}
          today={today}
          range={range}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {rows.length === 0 && !adding ? (
        <p className="faint" style={{ margin: 0 }}>
          {t("fixedNone")} {t("fixedNoneHint")}
        </p>
      ) : (
        <ul className="fixed-rows">
          {rows.map((row) => (
            <FixedRow
              key={row.template.id}
              row={row}
              category={
                row.template.categoryId
                  ? (categoryById.get(row.template.categoryId) ?? null)
                  : null
              }
              categories={categories}
              currency={currency}
              today={today}
              range={range}
              open={editingId === row.template.id}
              onToggle={(next) => {
                setAdding(false);
                setEditingId(next);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One fixed cost: what it is, when it repeats, and the form it opens into. */
function FixedRow({
  row,
  category,
  categories,
  currency,
  today,
  range,
  open,
  onToggle,
}: {
  row: FixedCostRow;
  category: BudgetCategory | null;
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
  range: DateRange;
  open: boolean;
  onToggle: (next: string | null) => void;
}) {
  const { t } = useI18n();

  return (
    <li className={cn("fixed-row", open && "open")}>
      <button
        type="button"
        className="fixed-row-head"
        aria-expanded={open}
        title={t("ledgerEdit")}
        onClick={() => onToggle(open ? null : row.template.id)}
      >
        <span
          className="fixed-row-icon"
          style={{
            background: `color-mix(in srgb, ${
              category?.color ?? "var(--text-faint)"
            } 18%, transparent)`,
          }}
          aria-hidden
        >
          {category?.icon ?? "🔁"}
        </span>

        <span className="fixed-row-text">
          <span className="fixed-row-name truncate">
            {row.template.note.trim() ||
              category?.name ||
              t("budgetUncategorised")}
          </span>
          <span className="fixed-row-when truncate">
            {describeCadence(row.template.recurrence, row.template.date, t)}
            {categorySuffix(row, category)}
          </span>
        </span>

        <Status row={row} />

        <span
          className={cn(
            "fixed-row-amount mono",
            row.template.flow.toLowerCase(),
          )}
        >
          {row.template.flow === "INCOME" ? "+" : "−"}
          {formatMoney(row.template.amountMinor, currency)}
        </span>
      </button>

      {open ? (
        <FixedEditor
          row={row}
          categories={categories}
          currency={currency}
          today={today}
          range={range}
          onDone={() => onToggle(null)}
        />
      ) : null}
    </li>
  );
}

/** The category, unless the name already says it: "Kira" needs no "Kira" after it. */
function categorySuffix(row: FixedCostRow, category: BudgetCategory | null): string {
  const name = row.template.note.trim();
  if (!category || !name || fold(category.name) === fold(name)) return "";
  return " · " + category.name;
}

/** Where this template stands in the window on screen. */
function Status({ row }: { row: FixedCostRow }) {
  const { t } = useI18n();

  if (row.dates.length === 0) {
    return (
      <span className="fixed-badge quiet">
        {row.nextDate
          ? t("fixedNext", { date: formatDate(row.nextDate, "d MMM") })
          : t("fixedEnded")}
      </span>
    );
  }

  if (row.pendingDates.length === 0) {
    return (
      <span className="fixed-badge done">
        <Check size={11} /> {t("fixedRecorded")}
      </span>
    );
  }

  const next = row.pendingDates[0];
  return (
    <span className="fixed-badge waiting">
      <Clock3 size={11} />
      {next ? formatDate(next, "d MMM") : t("fixedPending")}
    </span>
  );
}
