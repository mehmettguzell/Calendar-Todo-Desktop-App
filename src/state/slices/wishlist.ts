import { useUndoStore } from "../undoStore";
import {
  nowInstant,
  toLocalDate,
} from "@/domain/datetime";
import { createId } from "@/domain/ids";
import {
  normaliseLink,
  type WishlistItem,
} from "@/domain/wishlist";
import type { SliceTools, StoreState } from "../storeState";

// Things the user means to buy, and the transaction that closes one out.
export type WishlistSlice = Pick<
  StoreState,
  | "addWishlistItem"
  | "updateWishlistItem"
  | "removeWishlistItem"
  | "buyWishlistItem"
>;

export function createWishlistSlice({ get, commit }: SliceTools): WishlistSlice {
  return {
    addWishlistItem(draft) {
      const at = nowInstant();
      const item: WishlistItem = {
        id: createId("w"),
        title: draft.title.trim(),
        priceMinor:
          typeof draft.priceMinor === "number" && Number.isFinite(draft.priceMinor)
            ? Math.abs(Math.round(draft.priceMinor))
            : null,
        url: normaliseLink(draft.url ?? ""),
        note: draft.note?.trim() ?? "",
        categoryId: draft.categoryId ?? null,
        // Newest first is wrong for a shopping list — the thing you added last
        // is the thing you are still thinking about — so it goes on the end.
        order: get().db.wishlist.length,
        boughtAt: null,
        transactionId: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      commit((db) => ({ ...db, wishlist: [...db.wishlist, item] }));
      return item;
    },
    updateWishlistItem(id, patch) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        wishlist: db.wishlist.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
                title: patch.title === undefined ? item.title : patch.title.trim(),
                priceMinor:
                  patch.priceMinor === undefined
                    ? item.priceMinor
                    : patch.priceMinor === null
                      ? null
                      : Math.abs(Math.round(patch.priceMinor)),
                url: patch.url === undefined ? item.url : normaliseLink(patch.url ?? ""),
                updatedAt: at,
              }
            : item,
        ),
      }));
    },
    removeWishlistItem(id) {
      const at = nowInstant();
      const previous = get().db.wishlist.find((item) => item.id === id);
      if (!previous) return;
      commit((db) => ({
        ...db,
        wishlist: db.wishlist.map((item) =>
          item.id === id ? { ...item, deletedAt: at, updatedAt: at } : item,
        ),
      }));
      useUndoStore.getState().push("undoneWishlistRemoved", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          wishlist: db.wishlist.map((item) =>
            item.id === id ? { ...item, deletedAt: null, updatedAt: at2 } : item,
          ),
        }));
      });
    },
    buyWishlistItem(id, date) {
      const item = get().db.wishlist.find((each) => each.id === id);
      if (!item || item.deletedAt !== null || item.boughtAt !== null) return null;
      if (item.priceMinor === null || item.priceMinor === 0) return null;

      const transaction = get().addTransaction({
        date: date ?? toLocalDate(new Date(get().now)),
        amountMinor: item.priceMinor,
        flow: "EXPENSE",
        categoryId: item.categoryId,
        // The name it was wanted under is the name it is remembered by.
        note: item.title,
      });

      const at = nowInstant();
      commit((db) => ({
        ...db,
        wishlist: db.wishlist.map((each) =>
          each.id === id
            ? { ...each, boughtAt: at, transactionId: transaction.id, updatedAt: at }
            : each,
        ),
      }));

      // One act, one reversal: the entry goes back out of the ledger and the
      // item back onto the list. Undoing half of it would leave the budget
      // charged for something the list still says has not been bought.
      useUndoStore.getState().push("undoneWishlistBought", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          transactions: db.transactions.map((entry) =>
            entry.id === transaction.id
              ? { ...entry, deletedAt: at2, updatedAt: at2 }
              : entry,
          ),
          wishlist: db.wishlist.map((each) =>
            each.id === id
              ? { ...each, boughtAt: null, transactionId: null, updatedAt: at2 }
              : each,
          ),
        }));
      });

      return transaction;
    },
  };
}
