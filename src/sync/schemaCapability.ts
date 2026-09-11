// Whether a table the schema migration adds is actually present. A project that
// has not run the latest SQL downgrades that one feature rather than failing
// the whole pass. Missing columns are handled separately, in data/dto.

const availableTables = new Map<string, boolean>();

export function isMissingRelation(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  // PGRST204 is the *column* case and reads almost identically; excluded here so
  // one missing column does not disable a whole collection.
  if (error.code === "PGRST204" || /column/i.test(message)) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(message)
  );
}

/** Record that a table is absent so later passes stop asking for it. */
export function noteRelationMissing(table: string): void {
  if (availableTables.get(table) !== false) {
    console.info(
      `[tempo sync] public.${table} is not in this project yet — run supabase/schema.sql to sync it.`,
    );
  }
  availableTables.set(table, false);
}

export function tableAvailable(table: string): boolean {
  return availableTables.get(table) !== false;
}
