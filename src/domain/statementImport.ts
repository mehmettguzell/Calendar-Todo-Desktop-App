import { fold, identifyMerchant, type MerchantMatch } from "./merchant";
import {
  categoryNamesFor,
  type BudgetCategory,
  type CategoryKey,
  type Transaction,
} from "./money";
import {
  matchableEntries,
  matchRows,
  settlePatch,
  type Match,
  type SettlePatch,
} from "./reconcile";
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
  /**
   * Why this row was thought to be the same purchase, for `similar`.
   *
   * Carried so the preview can say "two days apart, same shop" instead of
   * asking the user to take the match on faith.
   */
  match: Match | null;
  /**
   * Settle the matched entry instead of creating a second one.
   *
   * This is what makes logging a spend at the till safe: the statement finds
   * the row the user already wrote and confirms it, rather than filing a twin
   * beside it. On by default whenever a match was found.
   */
  merge: boolean;
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
  /**
   * The card this file belongs to.
   *
   * Stops a purchase on one card being matched against an identical one on
   * another, which is the failure mode that appears the moment someone imports
   * statements from two banks.
   */
  account?: string | null;
  /** How far the posting date may drift from the entry's. See `reconcile`. */
  matchWindowDays?: number;
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

    const categoryKey =
      KIND_CATEGORY[line.kind] ??
      merchant.categoryKey ??
      options.fallbackCategoryKey ??
      null;
    const category = categoryKey ? resolveCategory(categoryKey, categories) : null;
    if (categoryKey && !category) missing.add(categoryKey);
    if (merchant.confidence === "none") unknown.add(merchant.name);

    rows.push({
      line,
      merchant,
      externalId,
      categoryKey,
      categoryId: category?.id ?? null,
      status: alreadyImported ? "duplicate" : "new",
      existingId: alreadyImported?.id ?? null,
      match: null,
      merge: false,
      include: !alreadyImported && includeByDefault(line.kind),
    });
  }

  /*
   * Everything that is not already in the ledger by fingerprint is offered to
   * the reconciler, which looks for the entry the user (or their bank's
   * notification mail) already wrote for this purchase.
   *
   * Allocation happens across the whole file at once rather than row by row:
   * two identical purchases in the same week would otherwise both claim the
   * first entry that fitted. See `reconcile`.
   */
  const claimable = rows.filter((row) => row.status === "new");
  const matches = matchRows(
    claimable.map((row) => ({
      key: row.externalId,
      date: row.line.date,
      amountMinor: row.line.amountMinor,
      flow: row.line.flow,
      merchant: row.merchant.name,
      account: options.account ?? null,
    })),
    matchableEntries(live),
    (row) => row.key,
    { account: options.account ?? null, windowDays: options.matchWindowDays },
  );

  for (const row of claimable) {
    const match = matches.get(row.externalId);
    if (!match) continue;
    row.status = "similar";
    row.existingId = match.entry.id;
    row.match = match;
    // Merging is the right default: the entry exists because the user logged
    // the purchase, and the statement is here to confirm it, not to repeat it.
    row.merge = true;
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
    // A row being merged settles an entry that already exists; creating one as
    // well would be the very duplicate the match was found to prevent.
    .filter((row) => row.include && !row.merge)
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


/** One matched entry, and what the statement teaches it. */
export interface ImportMerge {
  entryId: string;
  patch: SettlePatch;
  /** For the preview and the undo toast. */
  merchant: string;
}

/**
 * The entries a confirmed plan settles rather than repeats.
 *
 * This is the other half of `draftsFrom`, and the half that makes logging a
 * spend the moment it happens safe: the statement arrives weeks later, finds
 * the row already there, and confirms it in place. One purchase, one record —
 * the same rule the task side of the app is built on.
 */
export function mergesFrom(
  plan: ImportPlan,
  at: string,
  options: { account?: string | null; keepDate?: boolean } = {},
): ImportMerge[] {
  const merges: ImportMerge[] = [];
  for (const row of plan.rows) {
    if (!row.include || !row.merge || !row.match) continue;
    merges.push({
      entryId: row.match.entry.id,
      merchant: row.merchant.name,
      patch: settlePatch(
        row.match.entry,
        {
          externalId: row.externalId,
          merchant: row.merchant.name,
          categoryId: row.categoryId,
          date: row.line.date,
        },
        { at, account: options.account ?? null, keepDate: options.keepDate },
      ),
    });
  }
  return merges;
}
