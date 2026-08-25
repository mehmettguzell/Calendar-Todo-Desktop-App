import { daysBetween } from "./datetime";
import { fold } from "./merchant";
import { isProvisional, type MoneyFlow, type Transaction } from "./money";
import type { LocalDate } from "./types";

/**
 * Recognising a purchase the ledger has already heard about.
 *
 * The moment spending can be logged as it happens, every purchase acquires up
 * to three witnesses: the row typed at the till, the bank's notification mail a
 * minute later, and the statement line weeks after that. They are one purchase.
 * Without this module they would be three rows, and a budget that triples a
 * month is worse than one that misses it — the miss is visible.
 *
 * The hard part is that the three witnesses disagree about the details:
 *
 *  - **The date moves.** A card purchase on Friday night posts on Monday. This
 *    is the single most common reason naive matching fails, so the match runs
 *    over a window of days rather than an equality.
 *  - **The merchant is written differently.** "Migros" at the till,
 *    "MIGROS TIC.A.S-KADIKOY TR" on the statement.
 *  - **The amount does not.** Fuzzy amounts would merge two genuinely separate
 *    purchases, and a wrongly merged pair is invisible afterwards — nothing in
 *    the ledger records that a row is missing. So the amount must be exact, and
 *    anything the bank settles at a different figure stays a separate row the
 *    user can see and decide about.
 *
 * The last rule is the one that makes this safe to run automatically: the
 * failure mode is a duplicate you can spot and delete, never a purchase that
 * silently disappeared.
 */

/** The shape of anything that can be matched: a statement row, or an alert. */
export interface Matchable {
  date: LocalDate;
  amountMinor: number;
  flow: MoneyFlow;
  /** Canonical merchant when one was recognised. */
  merchant?: string | null;
  /** Card/account the source belongs to, when known. */
  account?: string | null;
}

export interface MatchOptions {
  /**
   * How far apart the two records may sit, in days.
   *
   * Three covers a Friday purchase posting on Monday, which is the case this
   * exists for. Wider starts matching last week's identical coffee.
   */
  windowDays?: number;
  /** The card the incoming rows belong to, when the user has said. */
  account?: string | null;
}

export interface Match {
  entry: Transaction;
  /** Signed: negative when the ledger entry is earlier than the row. */
  distanceDays: number;
  /** The merchant names agree, after folding. */
  sameMerchant: boolean;
  /** Higher is a better match. Only meaningful within one comparison. */
  score: number;
}

export const DEFAULT_MATCH_WINDOW_DAYS = 3;

/** A fingerprint written by a statement import, as opposed to an alert. */
export function isStatementId(externalId: string | null | undefined): boolean {
  return typeof externalId === "string" && externalId.startsWith("stmt:");
}

/**
 * Entries a statement is allowed to claim.
 *
 * Anything a statement has already settled is matched by its fingerprint
 * instead; letting it be claimed again would let one import rewrite rows a
 * previous one wrote.
 *
 * An entry stamped by a *notification mail* stays claimable, which is the
 * whole three-witness story: the alert says "this purchase exists and I have
 * already told you about it", and the statement still has to arrive and say
 * what it finally cost.
 */
export function matchableEntries(transactions: Transaction[]): Transaction[] {
  return transactions.filter(
    (entry) =>
      entry.deletedAt === null && !entry.confirmedAt && !isStatementId(entry.externalId),
  );
}

function accountsConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim();
  const right = b?.trim();
  if (!left || !right) return false;
  return fold(left) !== fold(right);
}

function merchantsAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = fold(a ?? "");
  const right = fold(b ?? "");
  if (!left || !right) return false;
  // One side is often the other cut short: "MIGROS" vs "MIGROS TIC.A.S-KADIKOY".
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Score one candidate, or `null` when it cannot be the same purchase.
 *
 * Everything that could hide a real second purchase is a hard rule; everything
 * that is merely evidence is a weight.
 */
export function scoreMatch(
  row: Matchable,
  entry: Transaction,
  options: MatchOptions = {},
): Match | null {
  const windowDays = options.windowDays ?? DEFAULT_MATCH_WINDOW_DAYS;

  if (entry.flow !== row.flow) return null;
  if (entry.amountMinor !== row.amountMinor) return null;

  const account = row.account ?? options.account ?? null;
  if (accountsConflict(entry.account, account)) return null;

  const distanceDays = daysBetween(row.date, entry.date);
  if (Math.abs(distanceDays) > windowDays) return null;

  const sameMerchant = merchantsAgree(entry.merchant ?? entry.note, row.merchant);

  let score = 100;
  // Same day is the strongest signal after the amount; each day of drift is
  // one more chance that this is a different purchase of the same size.
  score -= Math.abs(distanceDays) * 12;
  if (sameMerchant) score += 40;
  if (account && entry.account?.trim()) score += 20;
  // A provisional entry is precisely what a statement is here to settle; a
  // confirmed one has already been spoken for.
  if (isProvisional(entry)) score += 15;

  return { entry, distanceDays, sameMerchant, score };
}

/**
 * Pair incoming rows with entries already in the ledger.
 *
 * Allocation is global rather than row-by-row: two coffees at the same price in
 * the same week would otherwise both claim whichever entry came first, leaving
 * the second one to import as a duplicate beside a row it should have taken.
 * Best pair wins, and both sides leave the pool.
 */
export function matchRows<T extends Matchable>(
  rows: T[],
  entries: Transaction[],
  keyOf: (row: T) => string,
  options: MatchOptions = {},
): Map<string, Match> {
  const candidates: { key: string; match: Match }[] = [];
  for (const row of rows) {
    for (const entry of entries) {
      const match = scoreMatch(row, entry, options);
      if (match) candidates.push({ key: keyOf(row), match });
    }
  }

  candidates.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      Math.abs(a.match.distanceDays) - Math.abs(b.match.distanceDays) ||
      a.match.entry.id.localeCompare(b.match.entry.id),
  );

  const byRow = new Map<string, Match>();
  const claimed = new Set<string>();
  for (const { key, match } of candidates) {
    if (byRow.has(key) || claimed.has(match.entry.id)) continue;
    byRow.set(key, match);
    claimed.add(match.entry.id);
  }
  return byRow;
}

/**
 * What a settled row teaches the entry it matched.
 *
 * Deliberately additive. The user's own note is what they wrote at the till and
 * survives; the bank contributes the things only it knows — the canonical
 * merchant, the fingerprint that stops a re-import creating a twin, and the
 * fact that the amount is now final. The category is only filled in when the
 * entry did not have one, because a category the user chose outranks a guess
 * made from a merchant name.
 */
export interface SettlePatch {
  externalId: string;
  merchant: string;
  /** Only present when the entry had no category of its own. */
  categoryId?: string | null;
  /** Only present when the posting date differs from the entry's. */
  date?: LocalDate;
  account?: string;
  confirmedAt: string;
  origin: "manual" | "alert" | "statement";
}

export function settlePatch(
  entry: Transaction,
  row: { externalId: string; merchant: string; categoryId: string | null; date: LocalDate },
  options: { at: string; account?: string | null; keepDate?: boolean } = { at: "" },
): SettlePatch {
  const patch: SettlePatch = {
    externalId: row.externalId,
    merchant: row.merchant,
    confirmedAt: options.at,
    // The entry keeps the story of where it started. Overwriting it with
    // "statement" would erase the fact that the user logged this one at the
    // till, which is the behaviour the reconciler exists to reward.
    origin: entry.origin ?? (entry.externalId ? "statement" : "manual"),
  };
  if (!entry.categoryId && row.categoryId) patch.categoryId = row.categoryId;
  // The posting date is the one the bank will use on every future statement,
  // so the ledger follows it — unless the caller would rather keep the day the
  // money was actually spent.
  if (!options.keepDate && row.date !== entry.date) patch.date = row.date;
  const account = options.account?.trim();
  if (account && !entry.account?.trim()) patch.account = account;
  return patch;
}
