import type { Transaction } from "@/domain/money";
import { canonicalRecurrence, nz } from "./rowValues";

export function toTransactionRow(
  t: Transaction,
  userId: string,
): Record<string, unknown> {
  return {
    id: t.id,
    user_id: userId,
    date: t.date,
    amount_minor: t.amountMinor,
    flow: t.flow,
    category_id: t.categoryId,
    note: t.note || null,
    recurrence: t.recurrence ?? null,
    recurrence_source_id: t.recurrenceSourceId ?? null,
    last_generated_for: t.lastGeneratedFor ?? null,
    merchant: t.merchant ?? null,
    external_id: t.externalId ?? null,
    instalments: t.instalments ?? null,
    import_id: t.importId ?? null,
    is_deleted: t.deletedAt !== null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export function transactionFromRow(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    date: row.date as string,
    amountMinor: Math.round(Number(row.amount_minor) || 0),
    flow: (row.flow as Transaction["flow"]) ?? "EXPENSE",
    categoryId: (row.category_id as string) ?? null,
    note: (row.note as string) ?? "",
    recurrence: (row.recurrence as Transaction["recurrence"]) ?? null,
    recurrenceSourceId: (row.recurrence_source_id as string) ?? null,
    lastGeneratedFor: (row.last_generated_for as string) ?? null,
    merchant: (row.merchant as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    instalments: typeof row.instalments === "number" ? row.instalments : null,
    importId: (row.import_id as string) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    deletedAt: row.is_deleted ? ((row.updated_at as string) ?? null) : null,
  };
}

export function localTransactionFingerprint(t: Transaction): string {
  return JSON.stringify([
    t.date,
    t.amountMinor,
    t.flow,
    nz(t.categoryId),
    nz(t.note),
    canonicalRecurrence(t.recurrence),
    nz(t.recurrenceSourceId),
    nz(t.lastGeneratedFor),
    nz(t.merchant),
    nz(t.externalId),
    t.instalments ?? null,
    t.deletedAt !== null,
  ]);
}

export function cloudTransactionFingerprint(
  row: Record<string, unknown>,
): string {
  return JSON.stringify([
    row.date,
    Math.round(Number(row.amount_minor) || 0),
    row.flow,
    nz(row.category_id),
    nz(row.note),
    canonicalRecurrence(row.recurrence),
    nz(row.recurrence_source_id),
    nz(row.last_generated_for),
    nz(row.merchant),
    nz(row.external_id),
    // A project without the column reads as "no plan", which is what every row
    // written before instalments existed actually is.
    typeof row.instalments === "number" ? row.instalments : null,
    Boolean(row.is_deleted),
  ]);
}
