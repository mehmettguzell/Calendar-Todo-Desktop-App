import { useMemo } from "react";
import { FileText, Undo2 } from "lucide-react";
import { formatDate, fromInstant, toLocalDate } from "@/domain/datetime";
import { formatMoney } from "@/domain/money";
import { isLive } from "@/domain/statementBatch";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";

/**
 * The calendar day an import happened on, in the reader's own clock.
 *
 * `importedAt` is UTC, so slicing the string off it would file a late-evening
 * import under the following day here — and, on the last night of a month,
 * under the following month, which is exactly the row this list must not lose.
 */
function importedOn(instant: string): string {
  return toLocalDate(fromInstant(instant));
}

/**
 * The statements that have been imported, and the way back out.
 *
 * Importing the same file twice is the easy mistake here, and it is not one
 * anybody catches in the seconds an undo toast lives: it shows up when the
 * month's total is read the next day, by which point the only remedy used to be
 * deleting a hundred rows by hand.
 *
 * So the list is deliberately small. One line per import — what it covered, how
 * much it added — and one button. It says nothing at all until a statement has
 * been imported, which for most people is most of the time.
 */
export function ImportedStatements({
  range,
  currency,
}: {
  range: { from: string; to: string };
  currency: string;
}) {
  const { t } = useI18n();
  const batches = useStore((s) => s.db.statementBatches);
  const revertImport = useStore((s) => s.revertImport);

  /*
   * Filed by the day it was loaded, not the period it covers.
   *
   * A statement arrives weeks after its own month, so grouping by the period
   * would put the August file loaded yesterday under August — invisible from
   * September, which is exactly where you are standing when the month's total
   * looks wrong. Grouping by the load date puts it where you will look for it,
   * and keeps the list to one month's worth instead of every import ever made.
   *
   * Each row still prints the period it covers, so "which statement is this"
   * is answered on the line rather than by the heading.
   */
  const visible = useMemo(
    () =>
      batches
        .filter((batch) => {
          if (batch.deletedAt !== null) return false;
          const day = importedOn(batch.importedAt);
          return day >= range.from && day <= range.to;
        })
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
    [batches, range.from, range.to],
  );

  if (visible.length === 0) return null;

  return (
    <section className="section imported-statements">
      <div className="section-head">
        <FileText size={14} />
        <h2>{t("statementsHeading")}</h2>
      </div>

      <ul className="statement-rows">
        {visible.map((batch) => {
          const live = isLive(batch);
          const period = `${batch.from} → ${batch.to}`;
          /*
           * An import recovered from a document written before imports were
           * recorded has no file name to show, and labelling it with the period
           * would print the same dates twice. The day it was loaded is the one
           * thing that line can still say, and the one the period cannot.
           */
          const title =
            batch.label === period
              ? formatDate(importedOn(batch.importedAt), "d MMMM yyyy")
              : batch.label;
          return (
            <li
              key={batch.id}
              className={cn("statement-row", !live && "is-reverted")}
            >
              <div className="statement-what">
                <strong className="truncate">{title}</strong>
                <span className="faint">
                  {period}
                  {batch.mode === "daily" ? ` · ${t("statementsModeDaily")}` : ""}
                  {batch.account ? ` · ${batch.account}` : ""}
                </span>
              </div>

              <span className="statement-count faint">
                {t("statementsEntryCount", { n: batch.createdCount })}
                {batch.settled.length > 0
                  ? ` · ${t("statementsSettledCount", { n: batch.settled.length })}`
                  : ""}
              </span>

              <span className="statement-amount mono">
                {formatMoney(batch.createdMinor, currency)}
              </span>

              {live ? (
                <button
                  type="button"
                  className="btn ghost sm statement-revert"
                  onClick={() => {
                    // The one destructive button on this list, and the one place
                    // the count is worth repeating: "23 entries" is what makes
                    // the difference between the right import and the wrong one.
                    const ok = confirm(
                      t("statementsRevertConfirm", {
                        label: title,
                        n: batch.createdCount,
                      }),
                    );
                    if (ok) revertImport(batch.id);
                  }}
                >
                  <Undo2 size={13} /> {t("statementsRevert")}
                </button>
              ) : (
                <span className="statement-done faint">
                  {t("statementsReverted")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
