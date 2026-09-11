import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { addDaysLocal, formatDate } from "@/domain/datetime";
import { fold } from "@/domain/merchant";
import {
  formatMoney,
  MONEY_FLOWS,
  type BudgetCategory,
  type MoneyFlow,
  type Transaction,
} from "@/domain/money";
import type { LocalDate } from "@/domain/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { LedgerRow } from "./LedgerRow";
import { FLOW_LABEL } from "./labels";

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
  openEntryId = null,
  onOpenedEntry,
}: {
  rows: Transaction[];
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
  /**
   * An entry to open the moment this list appears.
   *
   * How the summary hands its reader back what they just typed: the entry form
   * lives on one tab and the row it wrote lives on another, and without this
   * the way to correct a number you got wrong five seconds ago is to know
   * which tab it went to and find it there.
   */
  openEntryId?: string | null;
  /** Told once the row has been opened, so the request is not repeated. */
  onOpenedEntry?: () => void;
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
        entry.categoryId
          ? (categoryById.get(entry.categoryId)?.name ?? "")
          : "",
      ].join(" ");
      return fold(haystack).includes(needle);
    });
  }, [rows, flow, query, categoryById]);

  const days = useMemo(() => groupByDay(filtered), [filtered]);

  /*
   * Matched on the transaction rather than on the row key: an instalment
   * purchase is twelve rows, and the one to open is whichever of them this
   * period is showing.
   */
  useEffect(() => {
    if (!openEntryId) return;
    const match = rows.find((entry) => entry.id === openEntryId);
    if (match) setOpenId(rowKey(match));
    onOpenedEntry?.();
  }, [openEntryId, rows, onOpenedEntry]);

  return (
    <section className="card budget-ledger">
      <div className="section-head">
        <h3>{t("budgetEntries")}</h3>
        <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
          {t("ledgerCount", { n: filtered.length })}
        </span>
      </div>

      <p className="faint ledger-hint">{t("budgetEntriesHint")}</p>

      <div className="ledger-controls">
        <div className="segmented-tabs is-sm">
          <button
            type="button"
            className="segmented-tab"
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
                  <span
                    className="ledger-day-total income mono"
                    title={t("ledgerDayIn")}
                  >
                    +{formatMoney(day.inMinor, currency)}
                  </span>
                ) : null}
                {day.outMinor > 0 ? (
                  <span
                    className="ledger-day-total mono"
                    title={t("ledgerDayOut")}
                  >
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

/** Newest day first, each day's rows in the order the list already had them. */
function groupByDay(entries: Transaction[]): DayGroup[] {
  const days = new Map<LocalDate, DayGroup>();

  for (const entry of entries) {
    const day = days.get(entry.date) ?? {
      date: entry.date,
      entries: [],
      outMinor: 0,
      inMinor: 0,
    };
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
