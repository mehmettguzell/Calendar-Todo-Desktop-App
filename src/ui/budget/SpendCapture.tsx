import { useMemo, useRef, useState } from "react";
import { Check, Wallet } from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import { identifyMerchant } from "@/domain/merchant";
import {
  accountNames,
  categoryNameFor,
  formatMoney,
  parseAmount,
  type BudgetCategory,
} from "@/domain/money";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { Modal } from "@/ui/components/primitives";

/**
 * Logging a purchase at the moment it happens.
 *
 * Reached from the tray without finding the window first, because the whole
 * value is in the five seconds between paying and putting the phone away. It
 * asks for two things — how much, and where — and works the rest out: the
 * merchant rules that read a bank statement read "migros" just as well, so a
 * category almost never has to be chosen.
 *
 * The entry it writes is provisional. Nothing typed at a till is the final
 * number, and the statement will settle it later without creating a second row.
 */
export function SpendCapture({
  onClose,
  onOpenBudget,
}: {
  onClose: () => void;
  onOpenBudget?: () => void;
}) {
  const { t, language } = useI18n();
  const addTransaction = useStore((s) => s.addTransaction);
  const ensureBudgetCategory = useStore((s) => s.ensureBudgetCategory);
  const transactions = useStore((s) => s.db.transactions);
  const currency = useStore((s) => s.db.settings.currency ?? "TRY");

  const [amount, setAmount] = useState("");
  const [where, setWhere] = useState("");
  const [account, setAccount] = useState("");
  const [saved, setSaved] = useState<{ amountMinor: number; where: string } | null>(null);
  const [error, setError] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => accountNames(transactions), [transactions]);

  /*
   * What the shop suggests, shown live.
   *
   * A guess the user can see is a guess they can correct before it is written;
   * a silent one is a category they discover was wrong a month later, in a
   * report they no longer trust.
   */
  const guess = useMemo(() => {
    const text = where.trim();
    if (text.length < 2) return null;
    const match = identifyMerchant(text);
    if (!match.categoryKey) return null;
    return {
      name: match.name,
      categoryName: categoryNameFor(match.categoryKey, language),
    };
  }, [where, language]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const amountMinor = parseAmount(amount);
    if (amountMinor === null || amountMinor === 0) {
      setError(true);
      return;
    }

    const text = where.trim();
    const match = text ? identifyMerchant(text) : null;
    const category: BudgetCategory | null = match?.categoryKey
      ? ensureBudgetCategory(categoryNameFor(match.categoryKey, language), "EXPENSE")
      : null;

    addTransaction({
      date: toLocalDate(new Date()),
      amountMinor,
      flow: "EXPENSE",
      categoryId: category?.id ?? null,
      note: text,
      merchant: match?.confidence === "none" ? null : (match?.name ?? null),
      account: account.trim() || null,
      origin: "manual",
    });

    setSaved({ amountMinor, where: text });
    setAmount("");
    setWhere("");
    setError(false);
  };

  const again = () => {
    setSaved(null);
    // The next purchase is a different purchase; the card almost always is not.
    requestAnimationFrame(() => amountRef.current?.focus());
  };

  if (saved) {
    return (
      <Modal title={t("spendQuickTitle")} onClose={onClose} width={380}>
        <div className="spend-done">
          <Check size={30} />
          <strong>{formatMoney(saved.amountMinor, currency)}</strong>
          {saved.where ? <span className="faint">{saved.where}</span> : null}
          <span className="spend-provisional-note">{t("spendProvisionalHint")}</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={again}>
              {t("spendAnother")}
            </button>
            {onOpenBudget ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onOpenBudget();
                  onClose();
                }}
              >
                <Wallet size={14} /> {t("navBudget")}
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={onClose}>
                {t("close")}
              </button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("spendQuickTitle")} onClose={onClose} width={420}>
      <form className="spend-capture" onSubmit={submit}>
        <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
          {t("spendQuickHint")}
        </p>

        <input
          ref={amountRef}
          className="input spend-amount"
          inputMode="decimal"
          autoFocus
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
          list="spend-card-options"
          placeholder={t("spendCardPlaceholder")}
          aria-label={t("spendCard")}
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        />
        <datalist id="spend-card-options">
          {cards.map((card) => (
            <option key={card} value={card} />
          ))}
        </datalist>

        {guess ? (
          <p className="spend-guess">
            {t("spendGuessed")}: <strong>{guess.categoryName}</strong>
            <span className="faint"> · {guess.name}</span>
          </p>
        ) : null}

        <button type="submit" className="btn primary block">
          {t("add")}
        </button>
      </form>
    </Modal>
  );
}
