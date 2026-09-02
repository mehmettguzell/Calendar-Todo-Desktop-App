import { useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { addDaysLocal, formatDate } from "@/domain/datetime";
import {
  instalmentCount,
  outstandingCount,
  outstandingMinor,
} from "@/domain/instalments";
import { fold } from "@/domain/merchant";
import {
  formatMoney,
  isProvisional,
  originOf,
  parseAmount,
  MONEY_FLOWS,
  type BudgetCategory,
  type MoneyFlow,
  type Transaction,
} from "@/domain/money";
import type { LocalDate } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useStore } from "@/state/store";

const FLOW_LABEL: Record<MoneyFlow, TranslationKey> = {
  INCOME: "budgetIncome",
  EXPENSE: "budgetExpense",
  INVESTMENT: "budgetInvestment",
};

const ORIGIN_LABEL = {
  manual: "ledgerOriginManual",
  alert: "ledgerOriginAlert",
  statement: "ledgerOriginStatement",
} as const;

interface DayGroup {
  date: LocalDate;
  entries: Transaction[];
  outMinor: number;
  inMinor: number;
}

/**
 * Every entry in the period, one by one.
 *
 * The old version of this list led with the *category* on each row — so a
 * month of shopping read "Market, Market, Market" with the shop's name in grey
 * underneath. That is backwards: the category is the grouping, which the
 * breakdown above already draws; what a ledger is scanned for is the thing that
 * happened. So the shop or the note is the line, and the category is a chip
 * beside it.
 *
 * Days are the other half of the fix. A flat run of forty rows has no shape;
 * broken into days, each with its own total, the eye can find "what did
 * Saturday cost" without reading a single amount.
 */
/**
 * One row's identity in this list.
 *
 * A purchase on instalments appears once per monthly charge, so its id is not
 * unique here — over a year view the same plan is twelve rows. Everything that
 * points at a *row* (the key, which one is open) has to say which charge it
 * means; everything that points at the *purchase* still uses the plain id.
 */
function rowKey(entry: Transaction): string {
  return entry.instalmentIndex === undefined
    ? entry.id
    : `${entry.id}#${entry.instalmentIndex}`;
}

export function Ledger({
  rows,
  categories,
  currency,
  today,
}: {
  rows: Transaction[];
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
}) {
  const { t } = useI18n();
  const [flow, setFlow] = useState<MoneyFlow | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    return rows.filter((entry) => {
      if (flow !== "ALL" && entry.flow !== flow) return false;
      if (!needle) return true;
      // The four things a row shows are the four things it can be found by.
      const haystack = [
        entry.note,
        entry.merchant ?? "",
        entry.account ?? "",
        entry.categoryId ? (categoryById.get(entry.categoryId)?.name ?? "") : "",
      ].join(" ");
      return fold(haystack).includes(needle);
    });
  }, [rows, flow, query, categoryById]);

  const days = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <section className="card budget-ledger">
      <div className="section-head">
        <h3>{t("budgetMovements")}</h3>
        <span className="faint" style={{ fontSize: 12 }}>
          {t("ledgerCount", { n: filtered.length })}
        </span>
      </div>

      <p className="faint ledger-hint">{t("budgetMovementsHint")}</p>

      <div className="ledger-controls">
        <div className="segmented sm">
          <button
            type="button"
            aria-pressed={flow === "ALL"}
            onClick={() => setFlow("ALL")}
          >
            {t("ledgerAll")}
          </button>
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

        <label className="ledger-search">
          <Search size={14} aria-hidden />
          <input
            className="input"
            value={query}
            placeholder={t("ledgerSearch")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="btn ghost icon sm"
              aria-label={t("cancel")}
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          ) : null}
        </label>
      </div>

      {days.length === 0 ? (
        <p className="faint" style={{ margin: 0 }}>
          {rows.length === 0 ? t("budgetNothingYet") : t("ledgerNoMatch")}
        </p>
      ) : (
        <div className="ledger-days scroll">
          {days.map((day) => (
            <section key={day.date} className="ledger-day">
              <header className="ledger-day-head">
                <h4>{describeDay(day.date, today, t)}</h4>
                <span className="ledger-day-rule" aria-hidden />
                {day.inMinor > 0 ? (
                  <span className="ledger-day-total income mono" title={t("ledgerDayIn")}>
                    +{formatMoney(day.inMinor, currency)}
                  </span>
                ) : null}
                {day.outMinor > 0 ? (
                  <span className="ledger-day-total mono" title={t("ledgerDayOut")}>
                    −{formatMoney(day.outMinor, currency)}
                  </span>
                ) : null}
              </header>

              <ul className="ledger-rows">
                {day.entries.map((entry) => (
                  <LedgerRow
                    key={rowKey(entry)}
                    entry={entry}
                    category={
                      entry.categoryId
                        ? (categoryById.get(entry.categoryId) ?? null)
                        : null
                    }
                    categories={categories}
                    currency={currency}
                    today={today}
                    open={openId === rowKey(entry)}
                    onToggle={() =>
                      setOpenId(openId === rowKey(entry) ? null : rowKey(entry))
                    }
                    onClose={() => setOpenId(null)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function LedgerRow({
  entry,
  category,
  categories,
  currency,
  today,
  open,
  onToggle,
  onClose,
}: {
  entry: Transaction;
  category: BudgetCategory | null;
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const deleteTransaction = useStore((s) => s.deleteTransaction);
  /*
   * The purchase behind the row.
   *
   * A row of an instalment plan is one twelfth of a purchase — the right thing
   * to show in August, and the wrong thing to put in an edit form, where
   * saving it would replace the price with the monthly charge. Editing always
   * opens the purchase itself.
   */
  const purchase = useStore(
    (s) => s.db.transactions.find((row) => row.id === entry.id) ?? entry,
  );

  /*
   * What actually happened, in the user's own words.
   *
   * The shop when a statement or the bank named one, the note when they typed
   * one, and the category only as a last resort — a row that can say no more
   * than "Groceries" is a row that has nothing else to say.
   */
  const title =
    entry.merchant?.trim() ||
    entry.note.trim() ||
    category?.name ||
    t("budgetUncategorised");

  const origin = originOf(entry);
  const detail: string[] = [];
  if (category && fold(category.name) !== fold(title)) detail.push(category.name);
  if (entry.account) detail.push(entry.account);
  // Only worth saying when the note is not already the title.
  if (entry.note.trim() && fold(entry.note) !== fold(title)) detail.push(entry.note);

  return (
    <li className={cn("ledger-row", open && "open")}>
      <button
        type="button"
        className="ledger-row-head"
        aria-expanded={open}
        title={open ? t("ledgerClose") : t("ledgerEdit")}
        onClick={onToggle}
      >
        <span
          className="ledger-row-icon"
          style={{
            background: `color-mix(in srgb, ${
              category?.color ?? "var(--text-faint)"
            } 18%, transparent)`,
          }}
          aria-hidden
        >
          {category?.icon ?? "•"}
        </span>

        <span className="ledger-row-text">
          <span className="ledger-row-title truncate">{title}</span>
          {detail.length > 0 ? (
            <span className="ledger-row-detail truncate">{detail.join(" · ")}</span>
          ) : null}
        </span>

        <span className="ledger-row-tags">
          {entry.recurrence || entry.recurrenceSourceId ? (
            <span className="ledger-tag repeat" title={t("budgetRepeating")}>
              ↻
            </span>
          ) : null}
          {entry.instalmentIndex !== undefined ? (
            <span
              className="ledger-tag instalment"
              title={t("ledgerInstalmentHint", {
                index: entry.instalmentIndex,
                count: instalmentCount(purchase),
                total: formatMoney(purchase.amountMinor, currency),
              })}
            >
              {entry.instalmentIndex}/{instalmentCount(purchase)}
            </span>
          ) : null}
          {origin !== "manual" ? (
            <span className="ledger-tag">{t(ORIGIN_LABEL[origin])}</span>
          ) : null}
          {/*
            Only for what the *bank* announced and has not settled. A hold, a
            tip or a currency conversion really does settle at another figure,
            so the mark is worth having — but a row the user typed is exactly
            what they said it was, and badging every one of those turned a
            warning into wallpaper.
          */}
          {origin === "alert" && isProvisional(entry) ? (
            <span className="ledger-tag pending" title={t("spendProvisionalHint")}>
              {t("spendProvisional")}
            </span>
          ) : null}
        </span>

        <span className={cn("ledger-row-amount mono", entry.flow.toLowerCase())}>
          {entry.flow === "INCOME" ? "+" : "−"}
          {formatMoney(entry.amountMinor, currency)}
        </span>
      </button>

      {open ? (
        <EntryEditor
          entry={purchase}
          categories={categories}
          currency={currency}
          today={today}
          onClose={onClose}
          onDelete={() => {
            if (!window.confirm(t("ledgerDeleteConfirm"))) return;
            deleteTransaction(entry.id);
            onClose();
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * Correcting an entry in place.
 *
 * A ledger you can only delete from is a ledger you argue with: the shop
 * charged 84,50 rather than 8,45, and the only repair used to be deleting the
 * row and typing it again — which throws away the statement fingerprint that
 * stops the next import duplicating it.
 */
function EntryEditor({
  entry,
  categories,
  currency,
  today,
  onClose,
  onDelete,
}: {
  entry: Transaction;
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const updateTransaction = useStore((s) => s.updateTransaction);
  const ensureBudgetCategory = useStore((s) => s.ensureBudgetCategory);

  const [amount, setAmount] = useState(String(entry.amountMinor / 100));
  const [flow, setFlow] = useState<MoneyFlow>(entry.flow);
  const [categoryName, setCategoryName] = useState(
    categories.find((c) => c.id === entry.categoryId)?.name ?? "",
  );
  const [note, setNote] = useState(entry.note);
  const [account, setAccount] = useState(entry.account ?? "");
  const [date, setDate] = useState(entry.date);
  const [instalments, setInstalments] = useState(
    entry.instalments && entry.instalments > 1 ? String(entry.instalments) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const suggestions = categories.filter((category) => category.flow === flow);
  const outstanding = outstandingMinor(entry, today);

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

    const months = Number.parseInt(instalments, 10);

    updateTransaction(entry.id, {
      amountMinor: Math.abs(amountMinor),
      flow,
      categoryId: category?.id ?? null,
      note: note.trim(),
      account: account.trim() || null,
      date,
      // The field holds months, not money: the amount above stays the price of
      // the thing, and the monthly charge is worked out from the two.
      instalments: Number.isFinite(months) && months > 1 ? months : null,
    });
    onClose();
  };

  return (
    <form className="ledger-editor" onSubmit={submit}>
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

      <input
        className="input mono ledger-edit-amount"
        inputMode="decimal"
        aria-label={t("budgetAmount")}
        value={amount}
        aria-invalid={error !== null}
        onChange={(e) => {
          setAmount(e.target.value);
          setError(null);
        }}
      />

      <input
        className="input ledger-edit-category"
        list="ledger-category-options"
        aria-label={t("budgetCategory")}
        placeholder={t("budgetCategory")}
        value={categoryName}
        onChange={(e) => setCategoryName(e.target.value)}
      />
      <datalist id="ledger-category-options">
        {suggestions.map((category) => (
          <option key={category.id} value={category.name} />
        ))}
      </datalist>

      <input
        className="input ledger-edit-note"
        aria-label={t("budgetNote")}
        placeholder={t("budgetNote")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <input
        className="input ledger-edit-account"
        aria-label={t("budgetAccount")}
        placeholder={t("budgetAccount")}
        value={account}
        onChange={(e) => setAccount(e.target.value)}
      />

      <input
        className="input ledger-edit-date"
        type="date"
        aria-label={t("formStartDate")}
        value={date}
        onChange={(e) => setDate(e.target.value || entry.date)}
      />

      {/*
        Empty means "paid in one go", which is almost every row — so the field
        says nothing at all until somebody puts a number in it.
      */}
      <input
        className="input mono ledger-edit-instalments"
        inputMode="numeric"
        aria-label={t("budgetInstalments")}
        placeholder={t("budgetInstalmentsShort")}
        title={t("budgetInstalmentsHint")}
        value={instalments}
        onChange={(e) => setInstalments(e.target.value.replace(/\D/g, ""))}
      />

      <button type="submit" className="btn primary sm">
        {t("save")}
      </button>
      <button type="button" className="btn ghost sm" onClick={onClose}>
        {t("cancel")}
      </button>
      <button
        type="button"
        className="btn ghost icon sm danger"
        aria-label={t("delete")}
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
      {outstanding > 0 ? (
        <span className="ledger-edit-hint faint">
          {t("budgetInstalmentRemaining", {
            amount: formatMoney(outstanding, currency),
            n: outstandingCount(entry, today),
          })}
        </span>
      ) : null}
      {error ? <span className="budget-entry-error">{error}</span> : null}
    </form>
  );
}

/** Newest day first, each day's rows in the order the list already had them. */
function groupByDay(entries: Transaction[]): DayGroup[] {
  const days = new Map<LocalDate, DayGroup>();

  for (const entry of entries) {
    const day =
      days.get(entry.date) ??
      { date: entry.date, entries: [], outMinor: 0, inMinor: 0 };
    day.entries.push(entry);
    // Investment leaves the account like a spend does, so it counts as
    // outgoing here even though the summary refuses to call it a loss.
    if (entry.flow === "INCOME") day.inMinor += entry.amountMinor;
    else day.outMinor += entry.amountMinor;
    days.set(entry.date, day);
  }

  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** "Bugün", "Dün", then the date — the two days anyone actually looks for. */
function describeDay(
  date: LocalDate,
  today: LocalDate,
  t: (key: TranslationKey) => string,
): string {
  if (date === today) return t("ledgerToday");
  if (date === addDaysLocal(today, -1)) return t("ledgerYesterday");
  return formatDate(date, "d MMMM EEEE");
}
