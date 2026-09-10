/**
 * The three value coercions every cloud-row comparison needs.
 *
 * A row that leaves this device and comes back changes shape on the way:
 * PostgREST drops absent columns, Postgres re-spells timestamps, and the local
 * store treats `""` and `null` as the same empty. Unless both sides are put
 * through the same funnel, "has this row changed?" answers yes every time.
 */

/**
 * Collapses the three "empty" spellings that travel between the two stores:
 * `undefined` (absent column), `null` (cloud writes `x || null`), and `""`
 * (local store) all become `null`.
 */
export function nz(value: unknown): unknown {
  return value === undefined || value === null || value === "" ? null : value;
}

/**
 * A TIMESTAMPTZ compared as an instant, never as text: Postgres hands back
 * `2026-08-22T10:00:00+00:00` where the local store holds
 * `2026-08-22T10:00:00.000Z` — the same moment, a different string.
 */
export function nzInstant(value: unknown): number | string | null {
  if (value === undefined || value === null || value === "") return null;
  const ms = new Date(value as string).getTime();
  return Number.isNaN(ms) ? String(value) : ms;
}

/** Key order in a JSONB round-trip is not guaranteed, so rebuild it explicitly. */
export function canonicalRecurrence(value: unknown): string {
  if (!value || typeof value !== "object") return "null";
  const r = value as Record<string, unknown>;
  const byWeekday = Array.isArray(r.byWeekday)
    ? [...(r.byWeekday as number[])].sort((a, b) => a - b)
    : null;
  return JSON.stringify([
    nz(r.freq),
    typeof r.interval === "number" ? r.interval : 1,
    byWeekday && byWeekday.length > 0 ? byWeekday : null,
    nz(r.until),
    r.count ?? null,
  ]);
}
