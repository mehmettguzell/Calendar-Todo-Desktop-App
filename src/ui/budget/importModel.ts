import { useMemo, useRef, useState } from "react";
import {
  accountNames,
  CATEGORY_CATALOGUE,
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
import { extractPdfText, looksLikePdf, PdfTextError } from "@/services/pdfText";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useStore } from "@/state/store";

export type ImportRow = ImportPlan["rows"][number];

/** What went wrong with a PDF, in a sentence the user can act on. */
const PDF_ERRORS: Record<string, TranslationKey> = {
  password: "importPdfPassword",
  unreadable: "importPdfUnreadable",
  "no-text": "importPdfNoText",
};

/** Everything the import wizard holds between opening a file and writing it. */
/* eslint-disable-next-line max-lines-per-function -- twelve fields relayed over one plan */
export function useStatementImport() {
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
   * who writes their spending down as it happens and misses some of it.
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
   * Shown rather than described: "36 rows" and "8 days, 412,60" are two very
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
  const defaultChoice = (row: ImportRow) =>
    row.categoryId ?? (row.categoryKey ? `new:${row.categoryKey}` : "");
  const chosenCategory = (row: ImportRow) =>
    choices[row.externalId] ?? defaultChoice(row);

  /** Existing categories, plus the ones this statement would create. */
  const options = useMemo(
    () => categoryOptions(categories, plan?.missingCategories ?? [], language),
    [categories, plan?.missingCategories, language],
  );

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

  /*
   * Nothing is settled in daily mode.
   *
   * A top-up is by construction the part of a day no existing entry covers, so
   * there is no row for it to confirm — and confirming one would be claiming
   * the bank vouched for a figure the user guessed.
   */
  const write = (
    resolved: ImportPlan,
    label: string,
    batch: Parameters<typeof importTransactions>[2],
  ) => {
    if (mode === "daily") {
      const { drafts } = dailyDraftsFrom(resolved, transactions, label);
      importTransactions(drafts, [], batch);
      return { created: drafts.length, merged: 0 };
    }
    const drafts = draftsFrom(resolved);
    const merges = mergesFrom(resolved, new Date().toISOString(), {
      account: account.trim() || null,
    });
    importTransactions(drafts, merges, batch);
    return { created: drafts.length, merged: merges.length };
  };

  const confirm = () => {
    if (!plan) return;
    const picked = plan.rows.filter((row) => isIncluded(row.externalId, row.include));
    const created = ensureCategories(newCategoryKeys(picked, chosenCategory));
    /*
     * Resolve the two per-row decisions into the rows themselves before
     * splitting the plan, so `draftsFrom` and `mergesFrom` read the same
     * answers. Remapping afterwards by array position was only ever correct
     * while every ticked row produced exactly one draft, which stopped being
     * true the moment a row could settle an entry instead of creating one.
     */
    const rows = picked.map((row) => ({
      ...row,
      categoryId: resolveCategory(chosenCategory(row), created),
      merge: isMerging(row.externalId, row.merge),
    }));

    const label = fileName?.trim() || t("importBatchFallbackLabel");
    setDone(
      write({ ...plan, rows }, label, {
        label,
        account: account.trim() || null,
        from: plan.range?.from,
        to: plan.range?.to,
        mode,
      }),
    );
  };

  return {
    t,
    language,
    currency,
    plan,
    dailyPreview,
    options,
    done,
    error,
    reading,
    dragging,
    setDragging,
    fileName,
    setFileName,
    setError,
    setText,
    inputRef,
    account,
    setAccount,
    knownCards: accountNames(transactions),
    mode,
    setMode,
    setSourceOverride,
    isIncluded,
    setIncluded,
    isMerging,
    setMerging,
    chosenCategory,
    setChoices,
    readFile,
    confirm,
    selectedCount: plan
      ? plan.rows.filter((row) => isIncluded(row.externalId, row.include)).length
      : 0,
  };
}

export type ImportModel = ReturnType<typeof useStatementImport>;

/** Only the categories the ticked rows actually land in are worth creating. */
function newCategoryKeys(
  picked: ImportRow[],
  chosenCategory: (row: ImportRow) => string,
): CategoryKey[] {
  const keys = new Set<CategoryKey>();
  for (const row of picked) {
    const choice = chosenCategory(row);
    if (choice.startsWith("new:")) keys.add(choice.slice(4) as CategoryKey);
  }
  return [...keys];
}

function resolveCategory(
  choice: string,
  created: Record<string, string>,
): string | null {
  if (!choice.startsWith("new:")) return choice || null;
  return created[choice.slice(4)] ?? null;
}

function categoryOptions(
  categories: { id: string; icon: string; name: string }[],
  missing: CategoryKey[],
  language: string,
) {
  const existing = categories.map((category) => ({
    value: category.id,
    label: `${category.icon} ${category.name}`,
    pending: false,
  }));
  const pending = missing.map((key) => {
    const entry = CATEGORY_CATALOGUE[key];
    return {
      value: `new:${key}`,
      label: `${entry.icon} ${language === "tr" ? entry.tr : entry.en} +`,
      pending: true,
    };
  });
  return [...existing, ...pending];
}
