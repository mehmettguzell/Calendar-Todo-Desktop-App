import { useMemo, useState } from "react";
import { Check, Clock3, Plus, Repeat2, Trash2, X } from "lucide-react";
import { formatDate } from "@/domain/datetime";
import { fold } from "@/domain/merchant";
import {
  fixedCostTotals,
  fixedCostsInRange,
  formatMoney,
  parseAmount,
  MONEY_FLOWS,
  type BudgetCategory,
  type DateRange,
  type FixedCostRow,
  type MoneyFlow,
} from "@/domain/money";
import type { LocalDate, Recurrence, RecurrenceFreq } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useStore } from "@/state/store";

const FLOW_LABEL: Record<MoneyFlow, TranslationKey> = {
  INCOME: "budgetIncome",
  EXPENSE: "budgetExpense",
  INVESTMENT: "budgetInvestment",
};

/** Only the three cadences a standing charge actually comes in. */
const CADENCES: { freq: RecurrenceFreq; labelKey: TranslationKey }[] = [
  { freq: "MONTHLY", labelKey: "budgetRepeatMonthly" },
  { freq: "WEEKLY", labelKey: "budgetRepeatWeekly" },
  { freq: "YEARLY", labelKey: "budgetRepeatYearly" },
];

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
          {rows.map((row) => {
            const category = row.template.categoryId
              ? (categoryById.get(row.template.categoryId) ?? null)
              : null;
            const open = editingId === row.template.id;
            return (
              <li key={row.template.id} className={cn("fixed-row", open && "open")}>
                <button
                  type="button"
                  className="fixed-row-head"
                  aria-expanded={open}
                  title={t("ledgerEdit")}
                  onClick={() => {
                    setAdding(false);
                    setEditingId(open ? null : row.template.id);
                  }}
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
                      {/* The category, unless the name already is it — a row
                          called "Kira" does not need "· Kira" read back. */}
                      {category &&
                      row.template.note.trim() &&
                      fold(category.name) !== fold(row.template.note)
                        ? ` · ${category.name}`
                        : ""}
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
                    onDone={() => setEditingId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
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

/**
 * The one form, used to add and to edit.
 *
 * Same fields either way on purpose: a fixed entry the user created and one
 * they are correcting are the same record, and two different forms would be two
 * chances to disagree about what one is.
 */
function FixedEditor({
  row,
  categories,
  currency,
  today,
  range,
  onDone,
}: {
  row: FixedCostRow | null;
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
  range: DateRange;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const addTransaction = useStore((s) => s.addTransaction);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const deleteTransaction = useStore((s) => s.deleteTransaction);
  const ensureBudgetCategory = useStore((s) => s.ensureBudgetCategory);

  const template = row?.template ?? null;
  const rule = template?.recurrence ?? null;

  const [name, setName] = useState(template?.note ?? "");
  const [amount, setAmount] = useState(
    template ? String(template.amountMinor / 100) : "",
  );
  const [flow, setFlow] = useState<MoneyFlow>(template?.flow ?? "EXPENSE");
  const [categoryName, setCategoryName] = useState(
    categories.find((c) => c.id === template?.categoryId)?.name ?? "",
  );
  const [freq, setFreq] = useState<RecurrenceFreq>(rule?.freq ?? "MONTHLY");
  const [monthDay, setMonthDay] = useState<string>(
    rule?.byMonthDay != null
      ? String(rule.byMonthDay)
      : String(Number((template?.date ?? today).slice(8, 10))),
  );
  const [start, setStart] = useState<LocalDate>(template?.date ?? today);
  const [until, setUntil] = useState<string>(rule?.until ?? "");
  const [error, setError] = useState<string | null>(null);

  /*
   * Offered only when this period already holds an entry from this template.
   * A rent rise announced mid-month usually applies to the rent already
   * charged, and hunting that one row down in the ledger afterwards is exactly
   * the chore this panel is meant to remove. Off for past periods, where the
   * recorded figure is history rather than a mistake.
   */
  const currentEntry =
    row?.recorded.find((entry) => entry.id !== template?.id) ??
    (template && template.date >= range.from && template.date <= range.to
      ? template
      : null);
  const [alsoCurrent, setAlsoCurrent] = useState(
    currentEntry !== null && currentEntry !== template && range.to >= today,
  );

  const suggestions = categories.filter((category) => category.flow === flow);

  const buildRule = (): Recurrence => {
    const rest: Recurrence = { freq, interval: 1 };
    if (freq === "MONTHLY") {
      const day = Number(monthDay);
      rest.byMonthDay = day === -1 ? -1 : Math.min(31, Math.max(1, day || 1));
    }
    if (until) rest.until = until;
    return rest;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const amountMinor = parseAmount(amount);
    if (amountMinor === null || amountMinor === 0) {
      setError(t("budgetAmountInvalid"));
      return;
    }

    const category = categoryName.trim()
      ? ensureBudgetCategory(categoryName, flow)
      : null;
    const patch = {
      amountMinor: Math.abs(amountMinor),
      flow,
      categoryId: category?.id ?? null,
      note: name.trim(),
    };

    if (!template) {
      addTransaction({ ...patch, date: start, recurrence: buildRule() });
      onDone();
      return;
    }

    updateTransaction(template.id, {
      ...patch,
      date: start,
      recurrence: buildRule(),
    });
    if (alsoCurrent && currentEntry && currentEntry.id !== template.id) {
      updateTransaction(currentEntry.id, patch);
    }
    onDone();
  };

  const remove = () => {
    if (!template) return;
    const label = template.note.trim() || formatMoney(template.amountMinor, currency);
    if (!window.confirm(t("fixedDeleteConfirm", { name: label }))) return;
    deleteTransaction(template.id);
    onDone();
  };

  return (
    <form className="fixed-editor" onSubmit={submit}>
      <div className="segmented sm">
        {MONEY_FLOWS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={flow === option}
            onClick={() => setFlow(option)}
          >
            {t(FLOW_LABEL[option])}
          </button>
        ))}
      </div>

      <label className="fixed-field grow">
        <span>{t("fixedName")}</span>
        <input
          className="input"
          placeholder={t("fixedNamePlaceholder")}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="fixed-field">
        <span>{t("budgetAmount")}</span>
        <input
          className="input mono"
          inputMode="decimal"
          value={amount}
          aria-invalid={error !== null}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
        />
      </label>

      <label className="fixed-field">
        <span>{t("budgetCategory")}</span>
        <input
          className="input"
          list="fixed-category-options"
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
        />
        <datalist id="fixed-category-options">
          {suggestions.map((category) => (
            <option key={category.id} value={category.name} />
          ))}
        </datalist>
      </label>

      <label className="fixed-field">
        <span>{t("budgetRepeat")}</span>
        <select
          className="input"
          value={freq}
          onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
        >
          {CADENCES.map((cadence) => (
            <option key={cadence.freq} value={cadence.freq}>
              {t(cadence.labelKey)}
            </option>
          ))}
        </select>
      </label>

      {/* Only monthly has a day to choose. Rent on "the last day" is common
          enough — and impossible to write as a number that works in February —
          to deserve its own option rather than a 28/30/31 guess. */}
      {freq === "MONTHLY" ? (
        <label className="fixed-field">
          <span>{t("fixedDayOfMonth")}</span>
          <select
            className="input"
            value={monthDay}
            onChange={(e) => setMonthDay(e.target.value)}
          >
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
            <option value="-1">{t("fixedLastDayOption")}</option>
          </select>
        </label>
      ) : null}

      <label className="fixed-field">
        <span>{t("fixedStart")}</span>
        <input
          className="input"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value || today)}
        />
      </label>

      <label className="fixed-field">
        <span>{t("fixedEnd")}</span>
        <input
          className="input"
          type="date"
          title={t("fixedEndHint")}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </label>

      {currentEntry && currentEntry.id !== template?.id ? (
        <label className="fixed-also">
          <input
            type="checkbox"
            checked={alsoCurrent}
            onChange={(e) => setAlsoCurrent(e.target.checked)}
          />
          {t("fixedAlsoUpdateCurrent")}
        </label>
      ) : null}

      <div className="fixed-editor-actions">
        <button type="submit" className="btn primary sm">
          {template ? t("save") : t("add")}
        </button>
        <button type="button" className="btn ghost sm" onClick={onDone}>
          <X size={13} /> {t("cancel")}
        </button>
        {template ? (
          <button type="button" className="btn ghost sm danger" onClick={remove}>
            <Trash2 size={13} /> {t("delete")}
          </button>
        ) : null}
        {error ? <span className="budget-entry-error">{error}</span> : null}
      </div>
    </form>
  );
}

/**
 * "Her ayın 5. günü" — the sentence, not the rule.
 *
 * Short enough to sit on one line of a row, which is why it does not reach for
 * `describeRecurrence`: that one is written for a task panel with room for
 * "every 2 weeks on Monday, Wednesday until 3 March".
 */
function describeCadence(
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
