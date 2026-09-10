import type { BudgetCategory } from "@/domain/money";

export function toBudgetCategoryRow(
  c: BudgetCategory,
  userId: string,
): Record<string, unknown> {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    flow: c.flow,
    color: c.color,
    icon: c.icon,
    built_in: c.builtIn,
    sort_order: c.order,
    monthly_limit_minor: c.monthlyLimitMinor ?? null,
    is_deleted: false,
    updated_at: c.updatedAt,
  };
}

export function budgetCategoryFromRow(
  row: Record<string, unknown>,
): BudgetCategory {
  return {
    id: row.id as string,
    name: String(row.name ?? "").trim(),
    flow: (row.flow as BudgetCategory["flow"]) ?? "EXPENSE",
    color: (row.color as string) ?? "#64748b",
    icon: (row.icon as string) ?? "•",
    builtIn: Boolean(row.built_in),
    order: Number(row.sort_order) || 0,
    monthlyLimitMinor: (row.monthly_limit_minor as number) ?? null,
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export function localBudgetCategoryFingerprint(c: BudgetCategory): string {
  return JSON.stringify([
    c.name.trim(),
    c.flow,
    c.color,
    c.icon,
    c.builtIn,
    c.monthlyLimitMinor ?? null,
  ]);
}

export function cloudBudgetCategoryFingerprint(
  row: Record<string, unknown>,
): string {
  return JSON.stringify([
    String(row.name ?? "").trim(),
    row.flow,
    row.color,
    row.icon,
    Boolean(row.built_in),
    (row.monthly_limit_minor as number) ?? null,
  ]);
}
