import { ANONYMOUS_NAMESPACE } from "./namespace";
import { migrate, type Database } from "./db";
import type { Repository } from "./repository";

const KEY = "tempo.db.v1";

/** Existing installs keep the original key; accounts get a suffixed one. */
function keyFor(namespace: string): string {
  return namespace === ANONYMOUS_NAMESPACE ? KEY : `${KEY}.${namespace}`;
}

/** Browser fallback so `npm run dev` works without the Tauri shell. */
export function createLocalStorageRepository(namespace: string): Repository {
  const key = keyFor(namespace);
  return {
    name: "localStorage",
    namespace,
    async load() {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        return migrate(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(db: Database) {
      localStorage.setItem(key, JSON.stringify(db));
    },
    async clear() {
      localStorage.removeItem(key);
    },
  };
}
