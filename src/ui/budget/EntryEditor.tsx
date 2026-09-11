import {
  useState,
} from "react";
import {
  Trash2,
} from "lucide-react";
import {
  outstandingCount,
  outstandingMinor,
} from "@/domain/instalments";
import {
  formatMoney,
  parseAmount,
  MONEY_FLOWS,
  type BudgetCategory,
  type MoneyFlow,
  type Transaction,
} from "@/domain/money";
import type { LocalDate } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { FLOW_LABEL } from "./labels";

/**
 * Correcting an entry in place.
 *
 * A ledger you can only delete from is a ledger you argue with: the shop
 * charged 84,50 rather than 8,45, and the only repair used to be deleting the
 * row and typing it again — which throws away the statement fingerprint that
 * stops the next import duplicating it.
 */
export function EntryEditor({
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
      <div className="segmented-tabs is-sm">
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
