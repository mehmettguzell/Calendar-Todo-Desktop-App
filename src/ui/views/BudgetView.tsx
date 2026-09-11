import { FileUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyArt } from "@/ui/components/EmptyArt";
import { Empty } from "@/ui/components/primitives";
import { BudgetBar, BudgetTabs } from "@/ui/budget/BudgetHeader";
import { BudgetOverview } from "@/ui/budget/BudgetOverview";
import { clampToRange, useBudgetView, type BudgetModel } from "@/ui/budget/budgetModel";
import { FixedCosts } from "@/ui/budget/FixedCosts";
import { ImportedStatements } from "@/ui/budget/ImportedStatements";
import { Ledger } from "@/ui/budget/Ledger";
import { QuickEntry } from "@/ui/budget/QuickEntry";
import { StatementImport } from "@/ui/budget/StatementImport";
import { Wishlist } from "@/ui/budget/Wishlist";

/**
 * Budget: the same calendar, viewed in money.
 *
 * **Two questions, in this order, and never more than one at a time.**
 *
 * *Which stretch of time?* — the top row, and nothing else: back, forward,
 * today, and how long a window. It is the one control that changes the meaning
 * of every number under it, so it sits above everything and stays put.
 *
 * *Which question about that time?* — the tab strip, five answers:
 *
 *  1. **Özet** — where do I stand, and where did it go.
 *  2. **İşlemler** — what exactly happened, entry by entry.
 *  3. **Ekstreler** — what did the bank file add, and how do I take it back.
 *  4. **Sabit gelir/gider** — what comes round every period regardless.
 *  5. **Alınacaklar** — what I mean to buy, which is not money that has moved.
 *
 * The page used to answer all five at once, down one scroll: the wishlist,
 * then four totals, then the statements, then the entry form, then the
 * standing bills, then the breakdown, then the ledger. Three tab strips and
 * two forms were on screen simultaneously, each filtering something different,
 * and the only way to tell which strip drove which panel was to press one and
 * watch what moved. No single piece of it was wrong. There was simply no
 * moment at which the page was asking you one thing.
 *
 * The tabs are a sequence, not a filing cabinet: you land on the summary and
 * reach for a tab when the summary raises a question. Which one you were last
 * on outlives the view (`viewPrefsStore`) — coming back from Today to a page
 * you had already navigated is the app undoing a choice you just made.
 *
 * Nothing here is a second copy of anything. Every tab reads the same
 * transactions over the same range; the split is in the asking, not the data.
 */
export function BudgetView() {
  const m = useBudgetView();

  return (
    <div className="page wide budget">
      <BudgetBar model={m} />
      <BudgetTabs model={m} />

      {m.tab === "overview" ? <BudgetOverview model={m} /> : null}
      {m.tab === "entries" ? <EntriesTab model={m} /> : null}
      {m.tab === "statements" ? <StatementsTab model={m} /> : null}

      {/* Next along from the statements, and out of the month's own flow.
          The standing bills used to sit between the totals and the breakdown:
          the plan for the month printed in the middle of the account of what
          the month actually did.

          No line of explanation above it: the panel carries its own, and saying
          the same thing twice a centimetre apart is how a page starts reading
          as noise. */}
      {m.tab === "fixed" ? (
        <div className="section">
          <FixedCosts range={m.range} today={m.today} currency={m.currency} />
        </div>
      ) : null}

      {m.tab === "wishlist" ? <WishlistTab model={m} /> : null}

      {m.importOpen ? (
        <StatementImport onClose={() => m.setImportOpen(false)} />
      ) : null}
    </div>
  );
}

function EntriesTab({ model: m }: { model: BudgetModel }) {
  return (
    <>
      <QuickEntry defaultDate={clampToRange(m.today, m.range)} />
      <div className="section">
        <Ledger
          rows={m.rows}
          categories={m.categories}
          currency={m.currency}
          today={m.today}
          openEntryId={m.focusEntryId}
          onOpenedEntry={m.clearFocusEntry}
        />
      </div>
    </>
  );
}

function StatementsTab({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();

  if (m.statements.length === 0) {
    return (
      <Empty
        icon={<EmptyArt kind="notes" />}
        title={t("statementsEmpty")}
        hint={t("budgetStatementsHint")}
        action={
          <button
            type="button"
            className="btn primary"
            onClick={() => m.setImportOpen(true)}
          >
            <FileUp size={14} /> {t("importButton")}
          </button>
        }
      />
    );
  }

  return (
    <>
      <p className="budget-tab-hint section">{t("budgetStatementsHint")}</p>
      <ImportedStatements range={m.range} currency={m.currency} />
    </>
  );
}

function WishlistTab({ model: m }: { model: BudgetModel }) {
  const { t } = useI18n();

  return (
    <>
      <p className="budget-tab-hint section">{t("budgetWishlistHint")}</p>
      <Wishlist currency={m.currency} />
    </>
  );
}
