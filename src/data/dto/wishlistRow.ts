import { normaliseLink, type WishlistItem } from "@/domain/wishlist";
import { nz } from "./rowValues";

export function toWishlistRow(
  item: WishlistItem,
  userId: string,
): Record<string, unknown> {
  return {
    id: item.id,
    user_id: userId,
    title: item.title,
    price_minor: item.priceMinor,
    url: item.url,
    note: item.note || null,
    category_id: item.categoryId,
    sort_order: item.order,
    bought_at: item.boughtAt,
    transaction_id: item.transactionId,
    is_deleted: item.deletedAt !== null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export function wishlistFromRow(row: Record<string, unknown>): WishlistItem {
  const at = new Date().toISOString();
  return {
    id: row.id as string,
    title: String(row.title ?? ""),
    priceMinor:
      row.price_minor === null || row.price_minor === undefined
        ? null
        : Math.round(Number(row.price_minor) || 0),
    // Checked here as well as on the way out of the file: another device wrote
    // this, and a link is about to become an href on this one.
    url: typeof row.url === "string" ? normaliseLink(row.url) : null,
    note: (row.note as string) ?? "",
    categoryId: (row.category_id as string) ?? null,
    order: Number(row.sort_order) || 0,
    boughtAt: (row.bought_at as string) ?? null,
    transactionId: (row.transaction_id as string) ?? null,
    createdAt: (row.created_at as string) ?? at,
    updatedAt: (row.updated_at as string) ?? at,
    deletedAt: row.is_deleted ? ((row.updated_at as string) ?? at) : null,
  };
}

export function localWishlistFingerprint(item: WishlistItem): string {
  return JSON.stringify([
    item.title,
    item.priceMinor ?? null,
    nz(item.url),
    nz(item.note),
    nz(item.categoryId),
    item.order,
    nz(item.boughtAt),
    nz(item.transactionId),
    item.deletedAt !== null,
  ]);
}

export function cloudWishlistFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    String(row.title ?? ""),
    row.price_minor === null || row.price_minor === undefined
      ? null
      : Math.round(Number(row.price_minor) || 0),
    nz(row.url),
    nz(row.note),
    nz(row.category_id),
    Number(row.sort_order) || 0,
    nz(row.bought_at),
    nz(row.transaction_id),
    Boolean(row.is_deleted),
  ]);
}
