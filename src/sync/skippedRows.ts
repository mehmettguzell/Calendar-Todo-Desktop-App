import { useSyncStore } from "@/state/syncStore";

// A row that violates a NOT NULL / CHECK is left out of the push rather than
// failing the whole batch forever. The badge keeps that trade honest.

const warnedRows = new Set<string>();

export function warnUnsendable(table: string, id: string): void {
  // Badge every pass (it is rebuilt); console once (a stuck row would log forever).
  useSyncStore.getState().noteSkipped({ table, id });
  const key = `${table}:${id}`;
  if (warnedRows.has(key)) return;
  warnedRows.add(key);
  console.warn(
    `[tempo sync] ${table} row "${id}" is missing required fields and was left out of the push. ` +
      `It is local-only bookkeeping; the rest of this device still syncs.`,
  );
}
