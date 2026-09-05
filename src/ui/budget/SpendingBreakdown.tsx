import { useMemo, useState } from "react";
import { ChevronRight, Search, TrendingDown, TrendingUp } from "lucide-react";
import {
  formatMoney,
  limitStatus,
  parseAmount,
  type BudgetCategory,
  type Transaction,
} from "@/domain/money";
import {
  analyseSpending,
  searchMerchants,
  type DateRange,
  type MerchantSlice,
} from "@/domain/spending";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

/**
 * Where the money went, one level deeper than a category.
 *
 * A category total is a number you can only nod at. The same total split by
 * shop is a number you can do something about — and the two questions the user
 * actually asks ("how much on groceries", "how much at Migros") sit at
 * different levels of the same tree, so the tree is what gets drawn.
 *
 * The comparison against the previous window is shown per category rather than
 * only in total: a month that came out level can still hide a category that
 * doubled.
 */
export function SpendingBreakdown({
  transactions,
  categories,
  range,
  previousRange,
  currency,
  onSetLimit,
}: {
  transactions: Transaction[];
  categories: BudgetCategory[];
  range: DateRange;
  previousRange: DateRange | null;
  currency: string;
  /**
   * Set or clear a category's monthly ceiling.
   *
   * The editor lives on the same row as the total it constrains, because a
   * limit is only meaningful next to the number it is being measured against —
   * put it anywhere else and it is a setting rather than a decision.
   */
  onSetLimit?: (categoryId: string, minor: number | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const report = useMemo(
    () => analyseSpending(transactions, categories, range, { compareWith: previousRange }),
    [transactions, categories, range, previousRange],
  );

  const matches = useMemo(
    () => (query.trim() ? searchMerchants(report, query) : null),
    [report, query],
  );

  const searchTotal = matches?.reduce((sum, slice) => sum + slice.amountMinor, 0) ?? 0;

  if (report.totalMinor === 0 && report.categories.length === 0) {
    return <p className="faint">{t("budgetNothingYet")}</p>;
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="spend-head">
        <div>
          <div className="spend-total mono">{formatMoney(report.totalMinor, currency)}</div>
          <div className="faint" style={{ fontSize: "var(--text-xs)" }}>
            {t("spendPerDay", { amount: formatMoney(report.perDayMinor, currency) })}
          </div>
          {/* The bars on the left count gross, because a limit is about what
              you charged. This total is net. Saying so is cheaper than making
              someone wonder why one category shows two numbers. */}
          {report.refundMinor > 0 ? (
            <div className="faint" style={{ fontSize: "var(--text-2xs)" }}>
              {t("spendNetNote", {
                gross: formatMoney(report.grossMinor, currency),
                refund: formatMoney(report.refundMinor, currency),
              })}
            </div>
          ) : null}
        </div>
        {report.changeRatio !== null ? <Delta ratio={report.changeRatio} /> : null}
      </div>

      {/* "Sadece Migros" — the question a category total cannot answer. */}
      <label className="spend-search">
        <Search size={14} />
        <input
          className="input"
          value={query}
          placeholder={t("spendSearchMerchant")}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches ? (
          <span className="mono spend-search-total">
            {formatMoney(searchTotal, currency)}
          </span>
        ) : null}
      </label>

      {matches ? (
        matches.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>{t("spendNoMerchant")}</p>
        ) : (
          <ul className="spend-merchants standalone">
            {matches.map((slice) => (
              <MerchantRow
                key={`${slice.categoryId ?? "none"}:${slice.merchant}`}
                slice={slice}
                currency={currency}
                total={searchTotal}
              />
            ))}
          </ul>
        )
      ) : (
        <ul className="spend-categories">
          {report.categories.map((slice) => {
            const key = slice.categoryId ?? "none";
            const expanded = open === key;
            const category = slice.categoryId
              ? (categoryById.get(slice.categoryId) ?? null)
              : null;
            const limit = limitStatus(
              category?.monthlyLimitMinor,
              slice.amountMinor,
            );
            return (
              <li key={key} className={cn("spend-category", expanded && "open")}>
                <div className="spend-category-line">
                <button
                  type="button"
                  className="spend-category-head"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : key)}
                >
                  <ChevronRight size={14} className="spend-caret" />
                  <span aria-hidden>{slice.icon}</span>
                  <span className="spend-name truncate">
                    {slice.name || t("budgetUncategorised")}
                  </span>
                  <span className="faint spend-count">{slice.count}</span>
                  <span className="spend-track">
                    <span
                      className="spend-fill"
                      style={{
                        /* Against the ceiling when there is one, against the
                           biggest category when there is not: a bar measured
                           against a limit answers a different question, and
                           only one of the two can be drawn at a time. */
                        width: `${Math.min(100, Math.max(2, (limit ? limit.ratio : slice.share) * 100))}%`,
                        background: limit ? LIMIT_COLOURS[limit.state] : slice.color,
                      }}
                    />
                  </span>
                  <span className="mono spend-value">
                    {formatMoney(slice.amountMinor, currency)}
                    {limit ? (
                      <span className={cn("budget-limit-note", limit.state)}>
                        {" / "}
                        {formatMoney(limit.limitMinor, currency)}
                      </span>
                    ) : null}
                  </span>
                  {/* The bar measures against the ceiling when there is one,
                      so the number beside it has to mean the same thing —
                      a bar three-quarters full next to "%3" is two answers to
                      one question. */}
                  <span
                    className={cn("spend-share faint", limit && limit.state)}
                    title={
                      limit
                        ? t("budgetSetLimit")
                        : t("budgetWhereItWent")
                    }
                  >
                    %{Math.round((limit ? limit.ratio : slice.share) * 100)}
                  </span>
                  {slice.changeRatio !== null ? <Delta ratio={slice.changeRatio} small /> : null}
                </button>
                {category && onSetLimit ? (
                  <LimitInput
                    category={category}
                    currency={currency}
                    onChange={(minor) => onSetLimit(category.id, minor)}
                  />
                ) : null}
                </div>

                {expanded ? (
                  <ul className="spend-merchants">
                    {slice.merchants.map((merchant) => (
                      <MerchantRow
                        key={merchant.merchant}
                        slice={merchant}
                        currency={currency}
                        total={slice.amountMinor}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MerchantRow({
  slice,
  currency,
  total,
}: {
  slice: MerchantSlice;
  currency: string;
  total: number;
}) {
  const { t } = useI18n();
  const share = total > 0 ? slice.amountMinor / total : 0;

  return (
    <li className="spend-merchant">
      <span className="spend-name truncate">{slice.merchant}</span>
      <span className="faint spend-count">
        {t("spendVisits", { n: slice.count })}
      </span>
      <span className="spend-track thin">
        <span className="spend-fill" style={{ width: `${Math.max(2, share * 100)}%` }} />
      </span>
      <span className="mono spend-value">{formatMoney(slice.amountMinor, currency)}</span>
      <span className="faint spend-average mono">
        {t("spendAverage", { amount: formatMoney(slice.averageMinor, currency) })}
      </span>
      {slice.refundMinor > 0 ? (
        <span className="spend-refund mono">
          −{formatMoney(slice.refundMinor, currency)}
        </span>
      ) : null}
    </li>
  );
}

/** A month-on-month change. Up is bad here, so the colours are inverted. */
function Delta({ ratio, small = false }: { ratio: number; small?: boolean }) {
  const up = ratio > 0;
  const percent = Math.round(Math.abs(ratio) * 100);
  if (percent === 0) return null;
  return (
    <span className={cn("spend-delta", up ? "up" : "down", small && "sm")}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}%{percent}
    </span>
  );
}

const LIMIT_COLOURS = {
  ok: "#22c55e",
  close: "#eab308",
  over: "#ef4444",
} as const;

/**
 * The monthly ceiling for one category, edited in place.
 *
 * Hidden until the row is hovered when unset, so a view about where the money
 * went does not read as a form. Committed on blur rather than per keystroke: a
 * half-typed "3" should not briefly mean a three-kuruş budget.
 */
function LimitInput({
  category,
  currency,
  onChange,
}: {
  category: BudgetCategory;
  currency: string;
  onChange: (minor: number | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);

  const current = category.monthlyLimitMinor ?? null;
  const shown = draft ?? (current ? String(Math.round(current / 100)) : "");

  return (
    <input
      className="budget-limit-input"
      inputMode="numeric"
      placeholder={t("budgetLimit")}
      aria-label={`${t("budgetSetLimit")} — ${category.name}`}
      title={`${t("budgetSetLimit")} (${currency})`}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const parsed = parseAmount(draft);
        onChange(draft.trim() === "" || parsed === null ? null : Math.abs(parsed));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
