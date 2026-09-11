// Columns added after a table's first release. A project on the old schema.sql
// rejects the whole batch over one unknown key, so the write drops the column
// and retries; the omission is remembered for the session. See DECISIONS.md.

export const OPTIONAL_COLUMNS: Record<string, string[]> = {
  tasks: ["end_date", "estimate_minutes", "deadline"],
  transactions: ["merchant", "external_id", "instalments", "import_id"],
};

const droppedColumns = new Map<string, Set<string>>();

export function optionalColumnCount(table: string): number {
  return (OPTIONAL_COLUMNS[table] ?? []).length;
}

export function columnDropped(table: string, column: string): boolean {
  return droppedColumns.get(table)?.has(column) === true;
}

/** Drops only the column this error names; returns whether a retry is worth it. */
export function dropOptionalColumn(table: string, error: unknown): boolean {
  const column = missingOptionalColumn(table, error);
  if (!column) return false;
  const gone = droppedColumns.get(table) ?? new Set<string>();
  gone.add(column);
  droppedColumns.set(table, gone);
  console.info(
    `[tempo sync] public.${table}.${column} is not in this project yet — ` +
      "syncing without it. Run supabase/schema.sql to restore the field.",
  );
  return true;
}

export function withoutMissingColumns(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const gone = droppedColumns.get(table);
  if (!gone || gone.size === 0) return row;
  const copy = { ...row };
  for (const column of gone) delete copy[column];
  return copy;
}

export function missingOptionalColumn(
  table: string,
  error: unknown,
): string | null {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (!message) return null;
  for (const column of OPTIONAL_COLUMNS[table] ?? []) {
    if (message.includes(column)) return column;
  }
  return null;
}
