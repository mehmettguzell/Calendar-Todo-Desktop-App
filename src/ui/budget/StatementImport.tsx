import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileUp, Link2, Upload } from "lucide-react";
import { localeTag } from "@/domain/datetime";
import {
  accountNames,
  CATEGORY_CATALOGUE,
  formatMoney,
  type CategoryKey,
} from "@/domain/money";
import { parseStatement, type StatementSource } from "@/domain/statement";
import type { ImportMode } from "@/domain/statementBatch";
import {
  buildImportPlan,
  dailyDraftsFrom,
  draftsFrom,
  mergesFrom,
  type ImportPlan,
} from "@/domain/statementImport";
import { cn } from "@/lib/cn";
import { extractPdfText, looksLikePdf, PdfTextError } from "@/services/pdfText";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { Modal } from "@/ui/components/primitives";

/**
 * Bringing a bank statement into the ledger.
 *
 * Deliberately a two-step wizard with a preview in the middle. An importer that
 * writes straight from the file is a tool you can only use once — the first
 * wrong guess about a column or a category is in the ledger before you see it,
 * and unpicking eighty rows by hand costs more than typing them would have. The
 * preview is where the guesses are still cheap.
 */
export function StatementImport({ onClose }: { onClose: () => void }) {
  const { t, language } = useI18n();
  const categories = useStore((s) => s.db.budgetCategories);
  const transactions = useStore((s) => s.db.transactions);
  const currency = useStore((s) => s.db.settings.currency ?? "TRY");
  const ensureCategories = useStore((s) => s.ensureCategoriesForKeys);
  const importTransactions = useStore((s) => s.importTransactions);

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [sourceOverride, setSourceOverride] = useState<StatementSource | null>(null);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  /**
   * Which card this file belongs to.
   *
   * The one piece of context the file itself never carries reliably, and the
   * one that stops a 250 TL purchase on the Bonus card being matched against an
   * identical one on the World card the same afternoon.
   */
  const [account, setAccount] = useState("");
  /**
   * How this file should become entries.
   *
   * `rows` files every purchase the bank printed. `daily` files only the part
   * of each day the ledger does not already know about — the mode for someone
   * who writes their spending down as it happens and misses some of it. See
   * `dailyShortfalls`.
   */
  const [mode, setMode] = useState<ImportMode>("rows");
  const [merging, setMerging] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState<{ created: number; merged: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const plan: ImportPlan | null = useMemo(() => {
    if (!text.trim()) return null;
    const parsed = parseStatement(text, sourceOverride ? { source: sourceOverride } : {});
    return buildImportPlan(
      parsed.lines,
      parsed.skipped,
      transactions,
      categories,
      parsed.source,
      { account: account.trim() || null },
    );
  }, [text, sourceOverride, transactions, categories, account]);

  /**
   * What daily mode would actually write, computed as the toggle is flipped.
   *
   * Shown rather than described: "36 rows" and "8 days, 412,60 ₺" are two very
   * different imports, and which one is about to happen is not something to
   * work out from a sentence.
   */
  const dailyPreview = useMemo(() => {
    if (!plan) return null;
    const { days } = dailyDraftsFrom(plan, transactions, "");
    return {
      days: days.length,
      totalMinor: days.reduce((sum, day) => sum + day.shortfallMinor, 0),
    };
  }, [plan, transactions]);

  const isIncluded = (id: string, fallback: boolean) => included[id] ?? fallback;
  const isMerging = (id: string, fallback: boolean) => merging[id] ?? fallback;
  const knownCards = useMemo(() => accountNames(transactions), [transactions]);
  const chosenCategory = (id: string, fallback: string) => choices[id] ?? fallback;

  /** Existing categories, plus the ones this statement would create. */
  const options = useMemo(() => {
    const existing = categories.map((category) => ({
      value: category.id,
      label: `${category.icon} ${category.name}`,
      pending: false,
    }));
    const pending = (plan?.missingCategories ?? []).map((key) => {
      const entry = CATEGORY_CATALOGUE[key];
      return {
        value: `new:${key}`,
        label: `${entry.icon} ${language === "tr" ? entry.tr : entry.en} +`,
        pending: true,
      };
    });
    return [...existing, ...pending];
  }, [categories, plan?.missingCategories, language]);

  const defaultChoice = (row: ImportPlan["rows"][number]) =>
    row.categoryId ?? (row.categoryKey ? `new:${row.categoryKey}` : "");

  const selectedCount = plan
    ? plan.rows.filter((row) => isIncluded(row.externalId, row.include)).length
    : 0;

  /** What went wrong with a PDF, in a sentence the user can act on. */
  const PDF_ERRORS: Record<string, TranslationKey> = {
    password: "importPdfPassword",
    unreadable: "importPdfUnreadable",
    "no-text": "importPdfNoText",
  };

  const readFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    // A real .xlsx is a ZIP. Nothing here can read one, and saying so beats
    // showing a preview full of mojibake.
    if (head[0] === 0x50 && head[1] === 0x4b) {
      setText("");
      setError("importXlsxHint");
      return;
    }

    /*
     * The bytes decide, not the extension: a statement saved as `ekstre.txt`
     * out of a mail client is still a PDF, and a `.pdf` that is really a CSV
     * should still import.
     */
    if (looksLikePdf(head)) {
      setText("");
      setReading(true);
      try {
        setText(await extractPdfText(await file.arrayBuffer()));
      } catch (failure) {
        const reason = failure instanceof PdfTextError ? failure.reason : "unreadable";
        setError(PDF_ERRORS[reason] ?? "importPdfUnreadable");
      } finally {
        setReading(false);
      }
      return;
    }

    setText(await file.text());
  };

  const confirm = () => {
    if (!plan) return;
    const picked = plan.rows.filter((row) => isIncluded(row.externalId, row.include));

    // Create only the categories the ticked rows actually land in.
    const neededKeys = new Set<CategoryKey>();
    for (const row of picked) {
      const choice = chosenCategory(row.externalId, defaultChoice(row));
      if (choice.startsWith("new:")) neededKeys.add(choice.slice(4) as CategoryKey);
    }
    const createdCategories = ensureCategories([...neededKeys]);

    /*
     * Resolve the two per-row decisions into the rows themselves before
     * splitting the plan, so `draftsFrom` and `mergesFrom` read the same
     * answers. Remapping afterwards by array position was only ever correct
     * while every ticked row produced exactly one draft, which stopped being
     * true the moment a row could settle an entry instead of creating one.
     */
    const rows = picked.map((row) => {
      const choice = chosenCategory(row.externalId, defaultChoice(row));
      const categoryId = choice.startsWith("new:")
        ? (createdCategories[choice.slice(4)] ?? null)
        : choice || null;
      return { ...row, categoryId, merge: isMerging(row.externalId, row.merge) };
    });

    const resolved = { ...plan, rows };
    const label = fileName?.trim() || t("importBatchFallbackLabel");
    const batch = {
      label,
      account: account.trim() || null,
      from: plan.range?.from,
      to: plan.range?.to,
      mode,
    };

    /*
     * Nothing is settled in daily mode.
     *
     * A top-up is by construction the part of a day no existing entry covers,
     * so there is no row for it to confirm — and confirming one would be
     * claiming the bank vouched for a figure the user guessed.
     */
    if (mode === "daily") {
      const { drafts } = dailyDraftsFrom(resolved, transactions, label);
      importTransactions(drafts, [], batch);
      setDone({ created: drafts.length, merged: 0 });
      return;
    }

    const drafts = draftsFrom(resolved);
    const merges = mergesFrom(resolved, new Date().toISOString(), {
      account: account.trim() || null,
    });

    importTransactions(drafts, merges, batch);
    setDone({ created: drafts.length, merged: merges.length });
  };

  if (done !== null) {
    return (
      <Modal title={t("importTitle")} onClose={onClose} width={420}>
        <div className="col" style={{ gap: 10, alignItems: "center", padding: 12 }}>
          <Check size={32} style={{ color: "var(--success)" }} />
          <strong style={{ fontSize: 16 }}>{t("importDone", { n: done.created })}</strong>
          {done.merged > 0 ? (
            <strong style={{ fontSize: 13 }}>
              {t("importDoneMerged", { n: done.merged })}
            </strong>
          ) : null}
          <p className="faint" style={{ margin: 0, textAlign: "center", fontSize: 12.5 }}>
            {t("importDoneHint")}
          </p>
          <button type="button" className="btn primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t("importTitle")}
      onClose={onClose}
      width={880}
      footer={
        <>
          <span className="grow faint" style={{ fontSize: 12 }}>
            {plan ? t("importSelected", { n: selectedCount }) : t("importPickFile")}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={selectedCount === 0}
            onClick={confirm}
          >
            {t("importConfirm", { n: selectedCount })}
          </button>
        </>
      }
    >
      {!plan ? (
        <div className="col" style={{ gap: 12 }}>
          <div
            className={cn("import-drop", dragging && "over")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void readFile(file);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={26} />
            <strong>{t("importDropTitle")}</strong>
            <span className="faint" style={{ fontSize: 12.5, textAlign: "center" }}>
              {t("importDropHint")}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.csv,.txt,.xls,.tsv,application/pdf,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </div>

          {reading ? <p className="faint">{t("importReadingPdf")}</p> : null}

          {error ? (
            <p className="import-error">
              <AlertTriangle size={14} /> {t(error)}
            </p>
          ) : null}

          <label className="field">
            <span>{t("importPasteLabel")}</span>
            <textarea
              className="textarea mono"
              rows={6}
              placeholder={t("importPastePlaceholder")}
              onChange={(e) => {
                setFileName(null);
                setError(null);
                setText(e.target.value);
              }}
            />
          </label>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="import-summary">
            <span className="import-chip">
              <FileUp size={13} /> {fileName ?? t("importPasted")}
            </span>
            <span className="import-chip">
              {t("importReadCount", { n: plan.counts.total })}
            </span>
            {plan.counts.duplicate > 0 ? (
              <span className="import-chip warn">
                {t("importDuplicateCount", { n: plan.counts.duplicate })}
              </span>
            ) : null}
            {plan.counts.similar > 0 ? (
              <span className="import-chip match">
                <Link2 size={13} /> {t("importMergedCount", { n: plan.counts.similar })}
              </span>
            ) : null}
            {plan.skipped.length > 0 ? (
              <span className="import-chip">
                {t("importSkippedCount", { n: plan.skipped.length })}
              </span>
            ) : null}
            {plan.range ? (
              <span className="import-chip">
                {plan.range.from} → {plan.range.to}
              </span>
            ) : null}

            <span className="grow" />

            {/* Two ways to read one file, side by side rather than in a
                settings panel: which one is right depends on this file and
                this month, not on a preference set once. */}
            <div className="segmented sm">
              {(["rows", "daily"] as ImportMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  title={t(option === "rows" ? "importModeRowsHint" : "importModeDailyHint")}
                  onClick={() => setMode(option)}
                >
                  {t(option === "rows" ? "importModeRows" : "importModeDaily")}
                </button>
              ))}
            </div>

            {/* The one guess worth making reversible in one click. */}
            <div className="segmented sm">
              {(["card", "account"] as StatementSource[]).map((source) => (
                <button
                  key={source}
                  type="button"
                  aria-pressed={plan.source === source}
                  onClick={() => setSourceOverride(source)}
                >
                  {t(source === "card" ? "importSourceCard" : "importSourceAccount")}
                </button>
              ))}
            </div>
          </div>

          {mode === "daily" ? (
            <p className="import-daily-note">
              {dailyPreview && dailyPreview.days > 0
                ? t("importModeDailySummary", {
                    n: dailyPreview.days,
                    total: formatMoney(dailyPreview.totalMinor, currency, language),
                  })
                : t("importModeDailyNothing")}
            </p>
          ) : null}

          <label className="field import-account">
            <span>{t("importAccountLabel")}</span>
            <input
              className="input"
              list="import-card-options"
              placeholder={t("spendCardPlaceholder")}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <datalist id="import-card-options">
              {knownCards.map((card) => (
                <option key={card} value={card} />
              ))}
            </datalist>
            <span className="faint" style={{ fontSize: 11 }}>
              {t("importAccountHint")}
            </span>
          </label>

          <div className="import-table-wrap scroll">
            <table className="import-table">
              <thead>
                <tr>
                  <th />
                  <th>{t("fieldDate")}</th>
                  <th>{t("importMerchant")}</th>
                  <th>{t("formCategory")}</th>
                  <th>{t("importMatchColumn")}</th>
                  <th style={{ textAlign: "right" }}>{t("budgetAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => {
                  const on = isIncluded(row.externalId, row.include);
                  return (
                    <tr
                      key={row.externalId}
                      className={cn(
                        row.status !== "new" && "is-known",
                        !on && "is-off",
                      )}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={row.merchant.name}
                          onChange={(e) =>
                            setIncluded((prev) => ({
                              ...prev,
                              [row.externalId]: e.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td className="mono">
                        {new Date(`${row.line.date}T00:00:00`).toLocaleDateString(
                          localeTag(),
                          { day: "2-digit", month: "short" },
                        )}
                      </td>
                      <td>
                        <span className="import-merchant">{row.merchant.name}</span>
                        <span className="import-raw truncate">{row.line.description}</span>
                        {row.status !== "new" ? (
                          <span className="import-flag">
                            {t(
                              row.status === "duplicate"
                                ? "importAlreadyThere"
                                : "importLooksSame",
                            )}
                          </span>
                        ) : null}
                        {row.line.kind !== "spend" ? (
                          <span className="import-flag kind">
                            {t(`importKind_${row.line.kind}` as TranslationKey)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <select
                          className="select sm"
                          value={chosenCategory(row.externalId, defaultChoice(row))}
                          onChange={(e) =>
                            setChoices((prev) => ({
                              ...prev,
                              [row.externalId]: e.target.value,
                            }))
                          }
                        >
                          <option value="">{t("budgetUncategorised")}</option>
                          {options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="import-match">
                        {row.match ? (
                          <label className="import-merge">
                            <input
                              type="checkbox"
                              checked={isMerging(row.externalId, row.merge)}
                              onChange={(e) =>
                                setMerging((prev) => ({
                                  ...prev,
                                  [row.externalId]: e.target.checked,
                                }))
                              }
                            />
                            <span>
                              {isMerging(row.externalId, row.merge)
                                ? t("importMerge")
                                : t("importMergeNew")}
                            </span>
                            <span className="import-match-why">
                              {row.match.distanceDays === 0
                                ? t("importMatchSameDay")
                                : t("importMatchDays", {
                                    n: Math.abs(row.match.distanceDays),
                                  })}
                              {row.match.sameMerchant ? ` · ${t("importMatchMerchant")}` : ""}
                              {row.match.exactAmount
                                ? ""
                                : ` · ${t("importMatchAmount", {
                                    amount: formatMoney(
                                      row.match.entry.amountMinor,
                                      currency,
                                    ),
                                  })}`}
                            </span>
                          </label>
                        ) : null}
                      </td>
                      <td
                        className={cn(
                          "mono import-amount",
                          row.line.flow === "INCOME" && "in",
                        )}
                      >
                        {row.line.flow === "INCOME" ? "+" : "−"}
                        {formatMoney(row.line.amountMinor, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {plan.counts.similar > 0 ? (
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              {t("importMergeHint")}
            </p>
          ) : null}

          {/* Said separately from the hint above, because it asks for something:
              these rows do nothing unless the user ticks them. */}
          {plan.counts.near > 0 ? (
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              {t("importNearHint", { n: plan.counts.near })}
            </p>
          ) : null}

          {plan.unknownMerchants.length > 0 ? (
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              {t("importUnknownHint", { n: plan.unknownMerchants.length })}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
