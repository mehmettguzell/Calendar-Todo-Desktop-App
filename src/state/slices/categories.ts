import {
  pruneTombstones,
  tombstone,
} from "@/data/db";
import { nowInstant } from "@/domain/datetime";
import { createId } from "@/domain/ids";
import { Category } from "@/domain/types";
import { syncDeleteCategoryToCloud } from "@/sync/storeBridge";
import type { SliceTools, StoreState } from "../storeState";

// Task categories. Removing one detaches its tasks rather than deleting them.
export type CategorySlice = Pick<
  StoreState,
  | "addCategory"
  | "updateCategory"
  | "removeCategory"
>;

export function createCategorySlice({ get, commit }: SliceTools): CategorySlice {
  return {
    addCategory(name, color) {
      const trimmed = name.trim();
      const existing = trimmed
        ? get().db.categories.find(
            (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
          )
        : null;
      if (existing) {
        get().updateCategory(existing.id, { color });
        return existing;
      }
      const category: Category = {
        id: createId("c"),
        name: trimmed || "New Category",
        color,
        order: get().db.categories.length,
      };
      commit((db) => ({ ...db, categories: [...db.categories, category] }));
      return category;
    },
    updateCategory(id, patch) {
      commit((db) => ({
        ...db,
        categories: db.categories.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      }));
    },
    removeCategory(id) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        categories: db.categories.filter((c) => c.id !== id),
        tasks: db.tasks.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null, updatedAt: at } : t,
        ),
        tombstones: pruneTombstones([
          ...db.tombstones,
          tombstone("category", id, at),
        ]),
      }));
      void syncDeleteCategoryToCloud(id);
    },
  };
}
