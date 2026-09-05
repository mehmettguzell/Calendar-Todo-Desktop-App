import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { identifyMerchant } from "@/domain/merchant";
import {
  accountNames,
  categoryNameFor,
  formatMoney,
  isProvisional,
  parseAmount,
} from "@/domain/money";
import { daySpending } from "@/domain/spendLog";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { Modal } from "@/ui/components/primitives";

/**
 * The end-of-day question.
 *
 * Deliberately shows what the day already holds before asking for anything. The
 * automatic feed and the till-side capture cover most of a day between them, so
 * the honest question is "is this everything?" — which someone can answer from
 * memory in five seconds. "What did you spend today?" against an empty box is
 * the question that kills spending diaries in week two.
 */
export function DaySpendPrompt({ onClose }: { onClose: () => void }) {
  const { t, language } = useI18n();
  const transactions = useStore((s) => s.db.transactions);
  const categories = useStore((s) => s.db.budgetCategories);
  const currency = useStore((s) => s.db.settings.currency ?? "TRY");
  const addTransaction = useStore((s) => s.addTransaction);
  const ensureBudgetCategory = useStore((s) => s.ensureBudgetCategory);

  const today = toLocalDate(new Date());
  const day = useMemo(() => daySpending(transactions, today), [transactions, today]);
  const cards = useMemo(() => accountNames(transactions), [transactions]);
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const [amount, setAmount] = useState("");
  const [where, setWhere] = useState("");
  const [account, setAccount] = useState(cards[0] ?? "");
  const [error, setError] = useState(false);

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const amountMinor = parseAmount(amount);
    if (amountMinor === null || amountMinor === 0) {
      setError(true);
      return;
    }
    const text = where.trim();
    const match = text ? identifyMerchant(text) : null;
    const category = match?.categoryKey
      ? ensureBudgetCategory(categoryNameFor(match.categoryKey, language), "EXPENSE")
      : null;

    addTransaction({
      date: today,
      amountMinor,
      flow: "EXPENSE",
      categoryId: category?.id ?? null,
      note: text,
      merchant: match?.confidence === "none" ? null : (match?.name ?? null),
      account: account.trim() || null,
      origin: "manual",
    });
    setAmount("");
    setWhere("");
    setError(false);
  };

  return (
    <Modal
      title={t("spendDayTitle")}
      onClose={onClose}
      width={480}
      footer={
        <>
          <span className="grow faint" style={{ fontSize: "var(--text-xs)" }}>
            {day.provisionalCount > 0
              ? t("spendDayPending", { n: day.provisionalCount })
              : null}
          </span>
          <button type="button" className="btn primary" onClick={onClose}>
            {t("spendDayDone")}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <p className="faint" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
          {t("spendDayHint")}
        </p>

        <div className="spend-day-total">
          <span>{t("spendDayTotal")}</span>
          <strong>{formatMoney(day.outflowMinor, currency)}</strong>
        </div>

        {day.entries.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>
            {t("spendDayNothing")}
          </p>
        ) : (
          <ul className="spend-day-list scroll">
            {day.entries.map((entry) => {
              const category = entry.categoryId
                ? (categoryById.get(entry.categoryId) ?? null)
                : null;
              return (
                <li key={entry.id} className="spend-day-row">
                  <span aria-hidden className="spend-day-icon">
                    {category?.icon ?? "•"}
                  </span>
                  <span className="truncate">
                    {entry.merchant || entry.note || category?.name || "—"}
                  </span>
                  {isProvisional(entry) ? (
                    <span className="spend-badge" title={t("spendProvisionalHint")}>
                      {t("spendProvisional")}
                    </span>
                  ) : null}
                  <span
                    className={cn("mono grow", "spend-day-amount", entry.flow.toLowerCase())}
                  >
                    {entry.flow === "INCOME" ? "+" : "−"}
                    {formatMoney(entry.amountMinor, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <form className="spend-day-add" onSubmit={add}>
          <input
            className="input"
            inputMode="decimal"
            placeholder={t("budgetAmount")}
            aria-label={t("budgetAmount")}
            aria-invalid={error}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(false);
            }}
          />
          <input
            className="input"
            placeholder={t("spendWherePlaceholder")}
            aria-label={t("spendWhere")}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
          />
          <input
            className="input"
            list="spend-day-cards"
            placeholder={t("spendCardPlaceholder")}
            aria-label={t("spendCard")}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
          <datalist id="spend-day-cards">
            {cards.map((card) => (
              <option key={card} value={card} />
            ))}
          </datalist>
          <button type="submit" className="btn">
            <Plus size={14} /> {t("add")}
          </button>
        </form>
      </div>
    </Modal>
  );
}
