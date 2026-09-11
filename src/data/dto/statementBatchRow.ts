import type { SettledSnapshot, StatementBatch } from "@/domain/statementBatch";
import { nz } from "./rowValues";

export function toStatementBatchRow(
  b: StatementBatch,
  userId: string,
): Record<string, unknown> {
  return {
    id: b.id,
    user_id: userId,
    label: b.label,
    account: b.account,
    imported_at: b.importedAt,
    from_date: b.from,
    to_date: b.to,
    mode: b.mode,
    created_count: b.createdCount,
    created_minor: b.createdMinor,
    settled: b.settled,
    reverted_at: b.revertedAt,
    is_deleted: b.deletedAt !== null,
    updated_at: b.revertedAt ?? b.importedAt,
  };
}

export function statementBatchFromRow(
  row: Record<string, unknown>,
): StatementBatch {
  const at = new Date().toISOString();
  const importedAt = (row.imported_at as string) ?? at;
  return {
    id: row.id as string,
    label: String(row.label ?? ""),
    account: (row.account as string) ?? null,
    importedAt,
    from: String(row.from_date ?? ""),
    to: String(row.to_date ?? ""),
    mode: row.mode === "daily" ? "daily" : "rows",
    createdCount: Number(row.created_count) || 0,
    createdMinor: Math.round(Number(row.created_minor) || 0),
    settled: Array.isArray(row.settled)
      ? (row.settled as SettledSnapshot[])
      : [],
    revertedAt: (row.reverted_at as string) ?? null,
    deletedAt: row.is_deleted
      ? ((row.updated_at as string) ?? importedAt)
      : null,
  };
}

export function localStatementBatchFingerprint(b: StatementBatch): string {
  return JSON.stringify([
    b.label,
    nz(b.account),
    b.from,
    b.to,
    b.mode,
    b.createdCount,
    b.createdMinor,
    b.settled.length,
    nz(b.revertedAt),
    b.deletedAt !== null,
  ]);
}

export function cloudStatementBatchFingerprint(
  row: Record<string, unknown>,
): string {
  const settled = Array.isArray(row.settled) ? row.settled : [];
  return JSON.stringify([
    String(row.label ?? ""),
    nz(row.account),
    String(row.from_date ?? ""),
    String(row.to_date ?? ""),
    row.mode === "daily" ? "daily" : "rows",
    Number(row.created_count) || 0,
    Math.round(Number(row.created_minor) || 0),
    settled.length,
    nz(row.reverted_at),
    Boolean(row.is_deleted),
  ]);
}
