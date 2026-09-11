import { ChevronLeft, ChevronRight, FileUp } from "lucide-react";
import { formatMoney, stepPeriod } from "@/domain/money";
import { cn } from "@/lib/cn";
import type { BudgetTab } from "@/state/viewPrefsStore";
import { useI18n } from "@/lib/i18n";
import { Segmented } from "@/ui/components/Segmented";
import { describeRange, PERIODS, type BudgetModel } from "./budgetModel";

/**
 * Which stretch of time. One row, one job — every number below it is measured
 * against whatever this says.
 */
export function BudgetBar({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();
  const up = m.totals.net >= 0;

  return (
    <header className="budget-bar section">
      <div className="row" style={{ gap: 2 }}>
        <button
          type="button"
          className="btn ghost icon"
          aria-label={t("previous")}
          onClick={() => m.setAnchor(stepPeriod(m.anchor, m.period, -1))}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="btn ghost icon"
          aria-label={t("next")}
          onClick={() => m.setAnchor(stepPeriod(m.anchor, m.period, 1))}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <h2 className="budget-range">{describeRange(m.range, m.period)}</h2>

      {/* The one figure that stays on screen whichever tab is open: am I up or
          down, which is why anybody opened the page. The four cards that
          explain it live on Özet, where there is room to name them. */}
      <span
        className={cn("budget-range-net mono", up ? "is-positive" : "is-negative")}
        title={up ? t("budgetSurplus") : t("budgetDeficit")}
      >
        {up ? "+" : "−"}
        {formatMoney(Math.abs(m.totals.net), m.currency)}
      </span>

      <button type="button" className="btn sm" onClick={() => m.setAnchor(m.today)}>
        {t("today")}
      </button>

      <span className="grow" />

      <Segmented
        size="sm"
        ariaLabel={t("budgetPeriodAria")}
        value={m.period}
        onChange={m.setPeriod}
        segments={PERIODS.map((p) => ({ id: p.id, label: t(p.labelKey) }))}
      />
    </header>
  );
}

/** Which question about it. */
export function BudgetTabs({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();

  return (
    <nav className="budget-tabbar section">
      <Segmented<BudgetTab>
        ariaLabel={t("budgetTabsAria")}
        value={m.tab}
        onChange={m.setTab}
        segments={[
          { id: "overview", label: t("budgetTabOverview") },
          { id: "entries", label: t("budgetTabEntries"), count: m.rows.length },
          {
            id: "statements",
            label: t("budgetTabStatements"),
            count: m.statements.length,
          },
          { id: "fixed", label: t("budgetTabFixed"), count: m.fixedRows.length },
          {
            id: "wishlist",
            label: t("budgetTabWishlist"),
            count: m.wishlistOpen.length,
          },
        ]}
      />

      <span className="grow" />

      {/* Loading a statement acts on the whole window rather than on any one
          panel, so it stays reachable from every tab. */}
      <button type="button" className="btn sm" onClick={() => m.setImportOpen(true)}>
        <FileUp size={13} /> {t("importButton")}
      </button>
    </nav>
  );
}
