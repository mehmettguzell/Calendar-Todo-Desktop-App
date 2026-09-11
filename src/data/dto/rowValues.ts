// A row that round-trips through the cloud changes shape: absent columns drop,
// timestamps get re-spelled, "" and null blur. Both sides go through this funnel.

/** `undefined` / `null` / `""` all collapse to `null`. */
export function nz(value: unknown): unknown {
  return value === undefined || value === null || value === "" ? null : value;
}

/** Compare a TIMESTAMPTZ as an instant, not as text. */
export function nzInstant(value: unknown): number | string | null {
  if (value === undefined || value === null || value === "") return null;
  const ms = new Date(value as string).getTime();
  return Number.isNaN(ms) ? String(value) : ms;
}

/** JSONB key order is not stable, so rebuild the shape explicitly. */
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
