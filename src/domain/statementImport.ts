import { fold, identifyMerchant, type MerchantMatch } from "./merchant";
import {
  categoryNamesFor,
  type BudgetCategory,
  type CategoryKey,
  type Transaction,
} from "./money";
import type { SkippedRow, StatementLine, StatementSource } from "./statement";
import type { LocalDate } from "./types";

/**
 * Turning read statement rows into entries the ledger will accept.
 *
 * Three problems live here, and only here:
 *
 *  1. **Identity.** Re-importing August, or importing an August–September
 *     export that overlaps the one from last month, must not double the month.
 *     Each row gets a fingerprint derived from what the bank said, so the same
 *     row always produces the same id no matter how many times it arrives.
 *
 *  2. **Which rows are spending.** A card statement contains the payment that
 *     cleared it. Importing that as an expense counts every purchase twice.
 *
 *  3. **Where it goes.** A merchant suggests a category; the category may not
 *     exist yet in this document, and may be spelled in either language.
 */

export interface ImportRow {
  line: StatementLine;
  merchant: MerchantMatch;
  /** Stable identity of the statement row. See `externalIdFor`. */
  externalId: string;
  categoryKey: CategoryKey | null;
  /** Resolved when a category with that name already exists. */
  categoryId: string | null;
  status: "new" | "duplicate" | "similar";
  /** The entry it repeats, for `duplicate` and `similar`. */
  existingId: string | null;
  /** Ticked in the preview. Transfers arrive unticked. */
  include: boolean;
}

export interface ImportPlan {
  rows: ImportRow[];
  skipped: SkippedRow[];
  source: StatementSource;
  range: { from: LocalDate; to: LocalDate } | null;
  counts: {
    total: number;
    fresh: number;
    duplicate: number;
    similar: number;
    excluded: number;
  };
  /** Categories the statement needs that this document does not have yet. */
  missingCategories: CategoryKey[];
  /** Merchants no rule recognised, so the preview can offer them for review. */
  unknownMerchants: string[];
}

/**
 * The identity of a statement row.
 *
 * Built from the three things a bank cannot change between two exports of the
 * same month — the date, the amount, and the merchant — plus a counter for the
 * genuinely identical rows that a single day can contain. Two coffees at the
 * same price at the same shop are two purchases, not a duplicate; the counter
 * is what keeps the second one importable while still making a re-import of the
 * same file land on exactly the same pair of ids.
 */
export function externalIdFor(
  line: StatementLine,
  merchantName: string,
  occurrence: number,
): string {
  const key = fold(merchantName).replace(/[^A-Z0-9]/g, "").slice(0, 24);
  return `stmt:${line.date}:${line.amountMinor}:${key}:${occurrence}`;
}

/**
 * Rows worth importing by default.
 *
 * A payment moves money between two accounts the user already owns: it is not
 * spending, and counting it as such double-counts the purchases it settled. It
 * is still listed in the preview — unticked — because someone reconciling a
 * statement line by line wants to see that it was read, not silently dropped.
 */
function includeByDefault(kind: StatementLine["kind"]): boolean {
  return kind !== "payment";
}

/** Categories that pay for themselves rather than coming from the merchant. */
const KIND_CATEGORY: Partial<Record<StatementLine["kind"], CategoryKey>> = {
  fee: "fees",
  interest: "fees",
  cash: "cash",
};

/**
 * Find the category a key refers to in this document.
 *
 * Matched on the name in *either* language: a document started in English has a
 * category called "Groceries", and creating a second one called "Market" beside
 * it would split the very total the user is trying to read.
 */
export function resolveCategory(
  key: CategoryKey,
  categories: BudgetCategory[],
): BudgetCategory | null {
  const [tr, en] = categoryNamesFor(key);
  const wanted = new Set([fold(tr), fold(en)]);
  return categories.find((category) => wanted.has(fold(category.name))) ?? null;
}

export interface PlanOptions {
  /** Rows whose merchant is unrecognised still get this category, if given. */
  fallbackCategoryKey?: CategoryKey | null;
}

export function buildImportPlan(
  lines: StatementLine[],
  skipped: SkippedRow[],
  existing: Transaction[],
  categories: BudgetCategory[],
  source: StatementSource,
  options: PlanOptions = {},
): ImportPlan {
  const live = existing.filter((entry) => entry.deletedAt === null);
  const byExternalId = new Map<string, Transaction>();
  for (const entry of live) {
    if (entry.externalId) byExternalId.set(entry.externalId, entry);
  }

  /*
   * A softer net for entries typed in by hand before the statement arrived.
   * They carry no fingerprint, so only the shape of the movement can betray
   * them: same day, same amount, same direction.
   */
  const bySignature = new Map<string, Transaction>();
  for (const entry of live) {
    if (entry.externalId) continue;
    bySignature.set(`${entry.date}|${entry.amountMinor}|${entry.flow}`, entry);
  }

  const seen = new Map<string, number>();
  const rows: ImportRow[] = [];
  const missing = new Set<CategoryKey>();
  const unknown = new Set<string>();

  for (const line of lines) {
    const merchant = identifyMerchant(line.description);
    const signature = `${line.date}|${line.amountMinor}|${fold(merchant.name)}`;
    const occurrence = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, occurrence);

    const externalId = externalIdFor(line, merchant.name, occurrence);
    const alreadyImported = byExternalId.get(externalId);
    const lookAlike = bySignature.get(`${line.date}|${line.amountMinor}|${line.flow}`);

    const categoryKey =
      KIND_CATEGORY[line.kind] ??
      merchant.categoryKey ??
      options.fallbackCategoryKey ??
      null;
    const category = categoryKey ? resolveCategory(categoryKey, categories) : null;
    if (categoryKey && !category) missing.add(categoryKey);
    if (merchant.confidence === "none") unknown.add(merchant.name);

    const status: ImportRow["status"] = alreadyImported
      ? "duplicate"
      : lookAlike
        ? "similar"
        : "new";

    rows.push({
      line,
      merchant,
      externalId,
      categoryKey,
      categoryId: category?.id ?? null,
      status,
      existingId: alreadyImported?.id ?? lookAlike?.id ?? null,
      // Anything already in the ledger arrives unticked. The user can still
      // tick a "similar" row — it may genuinely be a second identical purchase.
      include: status === "new" && includeByDefault(line.kind),
    });
  }

  const dates = lines.map((line) => line.date).sort();
  return {
    rows,
    skipped,
    source,
    range:
      dates.length > 0
        ? { from: dates[0] as LocalDate, to: dates[dates.length - 1] as LocalDate }
        : null,
    counts: {
      total: rows.length,
      fresh: rows.filter((row) => row.status === "new").length,
      duplicate: rows.filter((row) => row.status === "duplicate").length,
      similar: rows.filter((row) => row.status === "similar").length,
      excluded: rows.filter((row) => !row.include).length,
    },
    missingCategories: [...missing],
    unknownMerchants: [...unknown],
  };
}

/** What the store needs to create one entry. Kept plain so the store owns ids. */
export interface ImportDraft {
  date: LocalDate;
  amountMinor: number;
  flow: Transaction["flow"];
  categoryId: string | null;
  note: string;
  merchant: string;
  externalId: string;
}

/**
 * The entries a confirmed plan produces.
 *
 * The note keeps the bank's own wording. The merchant is what the reports group
 * by, and the two are not the same thing: when a rule guesses wrong, the raw
 * descriptor is the only way to see why.
 */
export function draftsFrom(plan: ImportPlan): ImportDraft[] {
  return plan.rows
    .filter((row) => row.include)
    .map((row) => ({
      date: row.line.date,
      amountMinor: row.line.amountMinor,
      flow: row.line.flow,
      categoryId: row.categoryId,
      note: row.line.description,
      merchant: row.merchant.name,
      externalId: row.externalId,
    }));
}
