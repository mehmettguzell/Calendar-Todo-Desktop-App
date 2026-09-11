import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  accountNames,
  MONEY_FLOWS,
  parseAmount,
  type BudgetCategory,
  type MoneyFlow,
  type Transaction,
} from "@/domain/money";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { FLOW_LABEL } from "./labels";

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
export function QuickEntry({
  defaultDate,
  autoFocus = false,
  onAdded,
}: {
  defaultDate: string;
  /** Handed what was just written, so the page can offer it back. */
  onAdded?: (entry: Transaction) => void;
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

    onAdded?.(
      addTransaction({
        date,
        amountMinor,
        flow,
        categoryId: category?.id ?? null,
        note,
        account,
      }),
    );

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
