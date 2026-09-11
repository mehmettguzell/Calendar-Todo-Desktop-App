import { FileUp, Link2 } from "lucide-react";
import { formatMoney } from "@/domain/money";
import type { StatementSource } from "@/domain/statement";
import type { ImportMode } from "@/domain/statementBatch";
import type { ImportPlan } from "@/domain/statementImport";
import type { ImportModel } from "./importModel";

/** What the file turned out to contain, and the two guesses worth reversing. */
export function ImportSummary({
  model: m,
  plan,
}: {
  model: ImportModel;
  plan: ImportPlan;
}) {
  return (
    <div className="import-summary">
      <span className="import-chip">
        <FileUp size={13} /> {m.fileName ?? m.t("importPasted")}
      </span>
      <span className="import-chip">
        {m.t("importReadCount", { n: plan.counts.total })}
      </span>
      {plan.counts.duplicate > 0 ? (
        <span className="import-chip warn">
          {m.t("importDuplicateCount", { n: plan.counts.duplicate })}
        </span>
      ) : null}
      {plan.counts.similar > 0 ? (
        <span className="import-chip match">
          <Link2 size={13} /> {m.t("importMergedCount", { n: plan.counts.similar })}
        </span>
      ) : null}
      {plan.skipped.length > 0 ? (
        <span className="import-chip">
          {m.t("importSkippedCount", { n: plan.skipped.length })}
        </span>
      ) : null}
      {plan.range ? (
        <span className="import-chip">
          {plan.range.from} → {plan.range.to}
        </span>
      ) : null}

      <span className="grow" />

      {/* Two ways to read one file, side by side rather than in a settings
          panel: which one is right depends on this file and this month, not on
          a preference set once. */}
      <div className="segmented-tabs is-sm">
        {(["rows", "daily"] as ImportMode[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={m.mode === option}
            title={m.t(
              option === "rows" ? "importModeRowsHint" : "importModeDailyHint",
            )}
            onClick={() => m.setMode(option)}
          >
            {m.t(option === "rows" ? "importModeRows" : "importModeDaily")}
          </button>
        ))}
      </div>

      {/* The one guess worth making reversible in one click. */}
      <div className="segmented-tabs is-sm">
        {(["card", "account"] as StatementSource[]).map((source) => (
          <button
            key={source}
            type="button"
            aria-pressed={plan.source === source}
            onClick={() => m.setSourceOverride(source)}
          >
            {m.t(source === "card" ? "importSourceCard" : "importSourceAccount")}
          </button>
        ))}
      </div>
    </div>
  );
}

/** How much daily mode would top up, in the figures rather than in a sentence. */
export function DailyNote({ model: m }: { model: ImportModel }) {
  if (m.mode !== "daily") return null;
  const preview = m.dailyPreview;

  return (
    <p className="import-daily-note">
      {preview && preview.days > 0
        ? m.t("importModeDailySummary", {
            n: preview.days,
            total: formatMoney(preview.totalMinor, m.currency, m.language),
          })
        : m.t("importModeDailyNothing")}
    </p>
  );
}

/** Which card the file belongs to — the context no statement carries itself. */
export function ImportAccountField({ model: m }: { model: ImportModel }) {
  return (
    <label className="field import-account">
      <span>{m.t("importAccountLabel")}</span>
      <input
        className="input"
        list="import-card-options"
        placeholder={m.t("spendCardPlaceholder")}
        value={m.account}
        onChange={(e) => m.setAccount(e.target.value)}
      />
      <datalist id="import-card-options">
        {m.knownCards.map((card) => (
          <option key={card} value={card} />
        ))}
      </datalist>
      <span className="faint" style={{ fontSize: "var(--text-2xs)" }}>
        {m.t("importAccountHint")}
      </span>
    </label>
  );
}

/** The three things about this plan that ask the user to look again. */
export function ImportHints({
  model: m,
  plan,
}: {
  model: ImportModel;
  plan: ImportPlan;
}) {
  const note = (text: string) => (
    <p className="faint" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
      {text}
    </p>
  );

  return (
    <>
      {plan.counts.similar > 0 ? note(m.t("importMergeHint")) : null}
      {/* Said separately from the hint above, because it asks for something:
          these rows do nothing unless the user ticks them. */}
      {plan.counts.near > 0
        ? note(m.t("importNearHint", { n: plan.counts.near }))
        : null}
      {plan.unknownMerchants.length > 0
        ? note(m.t("importUnknownHint", { n: plan.unknownMerchants.length }))
        : null}
    </>
  );
}
