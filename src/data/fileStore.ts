import { invoke } from "@tauri-apps/api/core";
import { migrate, type Database } from "./db";
import type { Repository } from "./repository";

/**
 * Desktop persistence: one JSON file at `Documents/calendar/calendar-data.json`.
 *
 * The file I/O lives in Rust rather than behind the fs plugin, so the location
 * is fixed by the app instead of by a permission scope, and the write is
 * atomic (temp file + rename).
 */
export function createFileRepository(): Repository {
  return {
    name: "documents/calendar",

    async load() {
      const raw = await invoke<string | null>("load_database");
      if (!raw) return null;
      try {
        return migrate(JSON.parse(raw));
      } catch (error) {
        console.error("[tempo] the saved file could not be parsed", error);
        return null;
      }
    },

    async save(db: Database) {
      await invoke("save_database", { contents: JSON.stringify(db, null, 2) });
    },
  };
}

/** Absolute path of the data file, for display in Settings. */
export async function databasePath(): Promise<string> {
  return invoke<string>("database_path");
}
