import type { Category } from "@/domain/types";

export function toCategoryRow(
  cat: Category,
  userId: string,
  now: string,
): Record<string, unknown> {
  return {
    id: cat.id,
    user_id: userId,
    name: cat.name,
    color: cat.color,
    is_deleted: false,
    updated_at: now,
  };
}

export function categoryFromRow(
  row: Record<string, unknown>,
  order: number,
): Category {
  return {
    id: row.id as string,
    name: String(row.name ?? "").trim(),
    color: row.color as string,
    order,
  };
}

export function localCategoryFingerprint(cat: Category): string {
  return JSON.stringify([cat.name.trim(), cat.color, false]);
}

export function cloudCategoryFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    String(row.name ?? "").trim(),
    row.color,
    Boolean(row.is_deleted),
  ]);
}
