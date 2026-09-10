// The watermark for an incremental pull. One failure mode governs it all: a
// cursor that moves too far forward skips a row, and that row goes missing.

/** Rewind allowance for a device whose clock runs slow. */
export const CLOCK_SKEW_ALLOWANCE_MS = 2 * 60_000;

// Rewind at query time only — a stored-and-rewound cursor is rewound again
// next pass and walks backwards until it fetches everything.
export function rewound(stamp: string | null): string | null {
  if (!stamp) return null;
  const ms = new Date(stamp).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms - CLOCK_SKEW_ALLOWANCE_MS).toISOString();
}

/** Latest value of `column` across these rows, or the watermark we had. */
export function newestStamp(
  rows: Record<string, unknown>[],
  column: string,
  fallback: string | null,
): string | null {
  let newest = fallback;
  for (const row of rows) {
    const value = row[column];
    if (typeof value !== "string") continue;
    if (newest === null || value > newest) newest = value;
  }
  return newest;
}
