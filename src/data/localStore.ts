import { migrate, type Database } from "./db";
import type { Repository } from "./repository";

const KEY = "tempo.db.v1";

/** Browser fallback so `npm run dev` works without the Tauri shell. */
export function createLocalStorageRepository(): Repository {
  return {
    name: "localStorage",
    async load() {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      try {
        return migrate(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(db: Database) {
      localStorage.setItem(KEY, JSON.stringify(db));
    },
  };
}
