import { localeTag } from "@/domain/datetime";
import { formatMoney } from "@/domain/money";
import type { ImportPlan } from "@/domain/statementImport";
import { cn } from "@/lib/cn";
import type { TranslationKey } from "@/lib/i18n";
import type { ImportModel, ImportRow } from "./importModel";

/** The preview: every row the file produced, with the two decisions per row. */
export function ImportTable({
  model: m,
  plan,
}: {
  model: ImportModel;
  plan: ImportPlan;
}) {
  return (
    <div className="import-table-wrap scroll">
      <table className="import-table">
        <thead>
          <tr>
            <th />
            <th>{m.t("fieldDate")}</th>
            <th>{m.t("importMerchant")}</th>
            <th>{m.t("formCategory")}</th>
            <th>{m.t("importMatchColumn")}</th>
            <th style={{ textAlign: "right" }}>{m.t("budgetAmount")}</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((row) => (
            <PreviewRow key={row.externalId} model={m} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewRow({ model: m, row }: { model: ImportModel; row: ImportRow }) {
  const on = m.isIncluded(row.externalId, row.include);

  return (
    <tr className={cn(row.status !== "new" && "is-known", !on && "is-off")}>
      <td>
        <input
          type="checkbox"
          checked={on}
          aria-label={row.merchant.name}
          onChange={(e) =>
            m.setIncluded((prev) => ({ ...prev, [row.externalId]: e.target.checked }))
          }
        />
      </td>
      <td className="mono">{shortDate(row.line.date)}</td>
      <td>
        <span className="import-merchant">{row.merchant.name}</span>
        <span className="import-raw truncate">{row.line.description}</span>
        {row.status !== "new" ? (
          <span className="import-flag">
            {m.t(row.status === "duplicate" ? "importAlreadyThere" : "importLooksSame")}
          </span>
        ) : null}
        {row.line.kind !== "spend" ? (
          <span className="import-flag kind">
            {m.t(`importKind_${row.line.kind}` as TranslationKey)}
          </span>
        ) : null}
      </td>
      <td>
        <select
          className="select sm"
          value={m.chosenCategory(row)}
          onChange={(e) =>
            m.setChoices((prev) => ({ ...prev, [row.externalId]: e.target.value }))
          }
        >
          <option value="">{m.t("budgetUncategorised")}</option>
          {m.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="import-match">
        {row.match ? <MergeChoice model={m} row={row} /> : null}
      </td>
      <td className={cn("mono import-amount", row.line.flow === "INCOME" && "in")}>
        {row.line.flow === "INCOME" ? "+" : "−"}
        {formatMoney(row.line.amountMinor, m.currency)}
      </td>
    </tr>
  );
}

/** Settle the entry the ledger already has, or file this as a new one. */
function MergeChoice({ model: m, row }: { model: ImportModel; row: ImportRow }) {
  const match = row.match;
  if (!match) return null;
  const merging = m.isMerging(row.externalId, row.merge);

  return (
    <label className="import-merge">
      <input
        type="checkbox"
        checked={merging}
        onChange={(e) =>
          m.setMerging((prev) => ({ ...prev, [row.externalId]: e.target.checked }))
        }
      />
      <span>{merging ? m.t("importMerge") : m.t("importMergeNew")}</span>
      <span className="import-match-why">
        {match.distanceDays === 0
          ? m.t("importMatchSameDay")
          : m.t("importMatchDays", { n: Math.abs(match.distanceDays) })}
        {match.sameMerchant ? ` · ${m.t("importMatchMerchant")}` : ""}
        {match.exactAmount
          ? ""
          : ` · ${m.t("importMatchAmount", {
              amount: formatMoney(match.entry.amountMinor, m.currency),
            })}`}
      </span>
    </label>
  );
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(localeTag(), {
    day: "2-digit",
    month: "short",
  });
}
