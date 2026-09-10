/**
 * Columns added to a table after its first release.
 *
 * A user whose Supabase project still runs the original `schema.sql` has a
 * table without these, and PostgREST rejects the whole batch over one unknown
 * key rather than the key alone. Instead of failing sync until they run a
 * migration, the write is retried without the column and the omission is
 * remembered for the rest of the session — a local feature degrades to "this
 * device knows the field, the cloud does not", which beats a red sync badge.
 *
 * This registry is session state about the cloud schema, so it lives as a
 * single owned module rather than being threaded through every mapper.
 */
export const OPTIONAL_COLUMNS: Record<string, string[]> = {
  tasks: ["end_date", "estimate_minutes", "deadline"],
  transactions: ["merchant", "external_id", "instalments", "import_id"],
};

const droppedColumns = new Map<string, Set<string>>();

export function optionalColumnCount(table: string): number {
  return (OPTIONAL_COLUMNS[table] ?? []).length;
}

/** True once this session has stopped sending `column` to `table`. */
export function columnDropped(table: string, column: string): boolean {
  return droppedColumns.get(table)?.has(column) === true;
}

/**
 * Give up on the column this error names, if it is one we can live without.
 *
 * Returns whether anything was dropped, so the caller knows a retry is worth
 * making. Only the named column goes: two optional columns can ship in one
 * migration but land in different projects, and discarding one that does exist
 * would silently stop syncing a field for the rest of the session.
 */
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

/** Does this error name a column we are allowed to give up on? */
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
