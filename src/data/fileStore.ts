import { invoke } from "@tauri-apps/api/core";
import { migrate, type Database } from "./db";
import type { Repository } from "./repository";

/**
 * Desktop persistence: one JSON file per account under `Documents/calendar`.
 *
 * The file I/O lives in Rust rather than behind the fs plugin, so the location
 * is fixed by the app instead of by a permission scope, and the write is
 * atomic (temp file + rename).
 */
export function createFileRepository(namespace: string): Repository {
  return {
    name: "documents/calendar",
    namespace,

    async load() {
      const raw = await invoke<string | null>("load_database", { namespace });
      if (!raw) return null;
      try {
        return migrate(JSON.parse(raw));
      } catch (error) {
        console.error("[tempo] the saved file could not be parsed", error);
        return null;
      }
    },

    async save(db: Database) {
      await invoke("save_database", {
        contents: JSON.stringify(db, null, 2),
        namespace,
      });
    },

    async clear() {
      await invoke("clear_database", { namespace });
    },
  };
}

/** Absolute path of the data file, for display in Settings. */
export async function databasePath(namespace: string): Promise<string> {
  return invoke<string>("database_path", { namespace });
}
