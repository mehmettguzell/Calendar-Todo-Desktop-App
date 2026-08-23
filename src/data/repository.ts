import type { Database } from "./db";

/**
 * Persistence port.
 *
 * The app only ever loads and saves the whole document, which keeps the
 * contract small enough that swapping the JSON store for SQLite later touches
 * exactly one file.
 *
 * A repository is bound to one namespace (see `data/namespace.ts`): switching
 * accounts creates a new repository rather than filtering a shared one, so no
 * code path can accidentally read across the boundary.
 */
export interface Repository {
  readonly name: string;
  readonly namespace: string;
  load(): Promise<Database | null>;
  save(db: Database): Promise<void>;
  /** Drop this namespace's stored document. */
  clear(): Promise<void>;
}
