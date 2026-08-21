import type { Database } from "./db";

/**
 * Persistence port.
 *
 * The app only ever loads and saves the whole document, which keeps the
 * contract small enough that swapping the JSON store for SQLite later touches
 * exactly one file.
 */
export interface Repository {
  readonly name: string;
  load(): Promise<Database | null>;
  save(db: Database): Promise<void>;
}
