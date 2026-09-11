import {
  formatMoney,
  isProvisional,
  type Transaction,
  type TransactionOrigin,
} from "@/domain/money";
import { instalmentCount } from "@/domain/instalments";
import { useI18n } from "@/lib/i18n";
import { ORIGIN_LABEL } from "./labels";

/** The small marks after an entry's name: repeats, instalments, where it came from. */
export function LedgerRowTags({
  entry,
  purchase,
  origin,
  currency,
}: {
  entry: Transaction;
  purchase: Transaction;
  origin: TransactionOrigin;
  currency: string;
}) {
  const { t } = useI18n();

  return (
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
        Only for what the *bank* announced and has not settled. A hold, a tip or
        a currency conversion really does settle at another figure, so the mark
        is worth having — but a row the user typed is exactly what they said it
        was, and badging every one of those turned a warning into wallpaper.
      */}
      {origin === "alert" && isProvisional(entry) ? (
        <span className="ledger-tag pending" title={t("spendProvisionalHint")}>
          {t("spendProvisional")}
        </span>
      ) : null}
    </span>
  );
}
