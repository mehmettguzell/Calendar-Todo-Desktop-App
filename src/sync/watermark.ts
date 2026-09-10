/**
 * The watermark that decides which cloud rows an incremental pass asks for.
 *
 * One failure mode governs everything here: a cursor that moves too far forward
 * skips a row, and a skipped row is a silently missing task.
 */

/**
 * How far a watermark is rewound before it is used as a query bound.
 *
 * `updated_at` is written by whichever device made the edit, from its own
 * clock. A machine running two minutes slow would stamp edits below a watermark
 * taken from a machine on time, and `gte` would step straight over them.
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 2 * 60_000;

/**
 * Rewind a watermark by the skew allowance, at the moment it becomes a query.
 *
 * Never stored rewound: a stored-and-rewound cursor is rewound again on the
 * next pass, and walks steadily backwards until it is fetching everything.
 */
export function rewound(stamp: string | null): string | null {
  if (!stamp) return null;
  const ms = new Date(stamp).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms - CLOCK_SKEW_ALLOWANCE_MS).toISOString();
}

/** The latest value of `column` across these rows, or the watermark we had. */
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
