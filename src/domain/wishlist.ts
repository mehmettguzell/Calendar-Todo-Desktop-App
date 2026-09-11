import type { Instant } from "./types";

/**
 * The things you mean to buy but have not.
 *
 * It sits at the top of the budget rather than in a notes file for one reason:
 * a wish costs money. "Kulaklık 4.500 ₺, monitör 9.000 ₺" is not a shopping
 * list, it is 13.500 ₺ of intentions standing next to the month you can
 * actually afford — and seeing the two on one screen is the entire point.
 *
 * An item is not a transaction. Nothing here touches a total: wanting
 * something has never made anybody poorer. It becomes money only when the user
 * says they bought it, and then it becomes an ordinary ledger entry like any
 * other, because a purchase is a purchase whatever list it started on.
 */
export interface WishlistItem {
  id: string;
  title: string;
  /** What it costs, in minor units. Null while the price is still unknown. */
  priceMinor: number | null;
  /**
   * Where to buy it.
   *
   * Half the value of the list: a price with no link is a number you have to
   * go and find again. Stored exactly as `normaliseLink` accepted it — see
   * there for why this is never rendered raw.
   */
  url: string | null;
  note: string;
  /** Which budget category it would land in, when the user says. */
  categoryId: string | null;
  order: number;
  /**
   * When it stopped being a wish.
   *
   * The item is kept rather than removed: "did I already buy this" is a
   * question people ask a shopping list, and a list that forgets cannot answer
   * it. It leaves the open list and stays in the document.
   */
  boughtAt: Instant | null;
  /** The ledger entry buying it created, so undoing can take both back. */
  transactionId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  deletedAt: Instant | null;
}

/**
 * A link that is safe to put in an `href`.
 *
 * The user types this and the app renders it as something clickable, which is
 * exactly the shape of an injected `javascript:` URL — so the scheme is
 * checked rather than trusted, and anything that is not http(s) is refused
 * outright. A bare "amazon.com.tr/dp/..." is the normal way people paste a
 * link, so it is completed rather than rejected.
 *
 * Returns `null` when there is nothing usable, which is also what an empty
 * field means: no link.
 */
export function normaliseLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The host, for a label that fits: "amazon.com.tr" rather than 90 characters. */
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Still wanted: live, unbought, in the order the user put them in. */
export function openWishlist(items: WishlistItem[]): WishlistItem[] {
  return items
    .filter((item) => item.deletedAt === null && item.boughtAt === null)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

/** What the bought ones cost, newest first — the list's own small history. */
export function boughtWishlist(items: WishlistItem[]): WishlistItem[] {
  return items
    .filter((item) => item.deletedAt === null && item.boughtAt !== null)
    .sort((a, b) => (b.boughtAt ?? "").localeCompare(a.boughtAt ?? ""));
}

/**
 * What the list would cost.
 *
 * Items with no price count as nothing rather than blocking the sum: a list of
 * six things where one price is missing still answers "roughly how much", and
 * refusing to add up until every field is filled is how a total stops being
 * looked at.
 */
export function wishlistTotalMinor(items: WishlistItem[]): number {
  return items.reduce((sum, item) => sum + (item.priceMinor ?? 0), 0);
}

/** Items whose price is still unknown, so the total can say it is partial. */
export function unpricedCount(items: WishlistItem[]): number {
  return items.filter((item) => item.priceMinor === null).length;
}
