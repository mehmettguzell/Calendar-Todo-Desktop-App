import { Pencil, X } from "lucide-react";
import { fold } from "@/domain/merchant";
import {
  formatMoney,
  originOf,
  type BudgetCategory,
  type Transaction,
} from "@/domain/money";
import type { LocalDate } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { EntryEditor } from "./EntryEditor";
import { LedgerRowTags } from "./LedgerRowTags";

// One entry in the ledger, with everything it can be edited into.
export function LedgerRow({
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

  return (
    <li className={cn("ledger-row", open && "open")}>
      <div className="ledger-row-line">
        <LedgerRowHead
          entry={entry}
          purchase={purchase}
          category={category}
          currency={currency}
          open={open}
          onToggle={onToggle}
        />

        {/* The row has always opened into its editor on a click; the only thing
          that said so was a tooltip, which is a thing you find by accident.
          A number you typed wrong is the most ordinary reason to come back to
          this list, so the way to fix it is a control, in the place every
          other list in this app puts one. */}
        <button
          type="button"
          className={cn("btn ghost icon sm ledger-row-edit", open && "is-open")}
          title={open ? t("ledgerClose") : t("ledgerEdit")}
          aria-label={open ? t("ledgerClose") : t("ledgerEdit")}
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <X size={14} /> : <Pencil size={14} />}
        </button>
      </div>

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

/** The clickable summary: what it was, what it is marked with, what it cost. */
function LedgerRowHead({
  entry,
  purchase,
  category,
  currency,
  open,
  onToggle,
}: {
  entry: Transaction;
  purchase: Transaction;
  category: BudgetCategory | null;
  currency: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const { title, detail } = describeEntry(entry, category, t);

  return (
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
        {detail ? (
          <span className="ledger-row-detail truncate">{detail}</span>
        ) : null}
      </span>

      <LedgerRowTags
        entry={entry}
        purchase={purchase}
        origin={originOf(entry)}
        currency={currency}
      />

      <span
        className={cn("ledger-row-amount mono", entry.flow.toLowerCase())}
      >
        {entry.flow === "INCOME" ? "+" : "−"}
        {formatMoney(entry.amountMinor, currency)}
      </span>
    </button>
  );
}

/**
 * What actually happened, in the user's own words.
 *
 * The shop when a statement or the bank named one, the note when they typed
 * one, and the category only as a last resort — a row that can say no more than
 * "Groceries" is a row that has nothing else to say.
 */
function describeEntry(
  entry: Transaction,
  category: BudgetCategory | null,
  t: (key: TranslationKey) => string,
) {
  const title =
    entry.merchant?.trim() ||
    entry.note.trim() ||
    category?.name ||
    t("budgetUncategorised");

  const detail: string[] = [];
  if (category && fold(category.name) !== fold(title)) detail.push(category.name);
  if (entry.account) detail.push(entry.account);
  // Only worth saying when the note is not already the title.
  if (entry.note.trim() && fold(entry.note) !== fold(title)) detail.push(entry.note);

  return { title, detail: detail.join(" · ") };
}
