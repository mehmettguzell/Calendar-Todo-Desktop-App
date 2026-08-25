import { Check, Inbox, X } from "lucide-react";
import { formatDate } from "@/domain/datetime";
import { formatMoney } from "@/domain/money";
import { useI18n } from "@/lib/i18n";
import { decideAlert } from "@/services/spendFeed";
import { useSpendFeedStore } from "@/state/spendFeedStore";
import { useStore } from "@/state/store";

/**
 * Purchases the bank reported, waiting for a yes or no.
 *
 * Only appears when the feed is set to ask first, and disappears the moment the
 * queue empties — a card that is always on screen saying "nothing to review" is
 * a card that teaches people to stop looking at it.
 */
export function SpendFeedReview() {
  const { t } = useI18n();
  const pending = useSpendFeedStore((s) => s.pending);
  const currency = useStore((s) => s.db.settings.currency ?? "TRY");

  if (pending.length === 0) return null;

  return (
    <section className="card budget-feed section">
      <div className="section-head">
        <h3>
          <Inbox size={14} /> {t("feedReviewTitle")}
        </h3>
        <span className="faint" style={{ fontSize: 12 }}>
          {pending.length}
        </span>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>
        {t("feedReviewHint")}
      </p>

      <ul className="feed-rows">
        {pending.map((alert) => (
          <li key={alert.externalId} className="feed-row">
            <span className="feed-date mono">{formatDate(alert.date, "d MMM")}</span>
            <span className="feed-what truncate">
              <strong className="truncate">{alert.description}</strong>
              {alert.account ? <span className="faint">{alert.account}</span> : null}
            </span>
            <span className="mono feed-amount">
              {alert.flow === "INCOME" ? "+" : "−"}
              {formatMoney(alert.amountMinor, alert.currency || currency)}
            </span>
            <button
              type="button"
              className="btn sm"
              onClick={() => decideAlert(alert, false)}
            >
              <X size={13} /> {t("feedIgnore")}
            </button>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => decideAlert(alert, true)}
            >
              <Check size={13} /> {t("feedAccept")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
