import { beforeEach, describe, expect, it } from "vitest";
import { linkLabel, normaliseLink, openWishlist, wishlistTotalMinor } from "@/domain/wishlist";
import { summarise, transactionsInRange } from "@/domain/money";
import { useStore } from "@/state/store";
import { useUndoStore } from "@/state/undoStore";

/**
 * The list of things the user means to buy.
 *
 * Two rules carry the whole feature: a wish is not money until the user says
 * it is, and a link the user pasted is about to become an `href`.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const wishlist = () => useStore.getState().db.wishlist;
const openItems = () => openWishlist(wishlist());
const transactions = () =>
  useStore.getState().db.transactions.filter((t) => t.deletedAt === null);

describe("links", () => {
  it("completes a bare host, which is how people paste a link", () => {
    expect(normaliseLink("amazon.com.tr/dp/B0C")).toBe("https://amazon.com.tr/dp/B0C");
  });

  it("keeps a link that already says how to fetch it", () => {
    expect(normaliseLink("http://example.com/x")).toBe("http://example.com/x");
  });

  /**
   * The field is typed by a person and rendered as something clickable, which
   * is the exact shape of an injected script URL. Anything that is not http(s)
   * is refused rather than escaped.
   */
  it("refuses a scheme that is not http", () => {
    expect(normaliseLink("javascript:alert(1)")).toBeNull();
    expect(normaliseLink("data:text/html,<script>")).toBeNull();
    expect(normaliseLink("  ")).toBeNull();
  });

  it("labels a link by its host so the row stays readable", () => {
    expect(linkLabel("https://www.trendyol.com/very/long/path?x=1")).toBe("trendyol.com");
  });
});

describe("what the list costs", () => {
  it("adds up the prices it has", () => {
    const store = useStore.getState();
    store.addWishlistItem({ title: "Kulaklık", priceMinor: 450_000 });
    store.addWishlistItem({ title: "Monitör", priceMinor: 900_000 });

    expect(wishlistTotalMinor(openItems())).toBe(1_350_000);
  });

  it("counts an item with no price as nothing rather than refusing to add up", () => {
    const store = useStore.getState();
    store.addWishlistItem({ title: "Kulaklık", priceMinor: 450_000 });
    store.addWishlistItem({ title: "Sandalye" });

    expect(openItems()).toHaveLength(2);
    expect(wishlistTotalMinor(openItems())).toBe(450_000);
  });

  /** Wanting something has never made anybody poorer. */
  it("puts nothing in the budget", () => {
    useStore.getState().addWishlistItem({ title: "Kulaklık", priceMinor: 450_000 });

    expect(transactions()).toHaveLength(0);
  });

  it("stores a pasted link, and nothing that is not one", () => {
    const store = useStore.getState();
    const good = store.addWishlistItem({ title: "Kulaklık", url: "teknosa.com/x" });
    const bad = store.addWishlistItem({ title: "Monitör", url: "javascript:alert(1)" });

    expect(good.url).toBe("https://teknosa.com/x");
    expect(bad.url).toBeNull();
  });
});

describe("buying something off the list", () => {
  const seed = () =>
    useStore.getState().addWishlistItem({ title: "Kulaklık", priceMinor: 450_000 });

  it("writes one ordinary expense and takes the item off the list", () => {
    const item = seed();

    const entry = useStore.getState().buyWishlistItem(item.id);

    expect(entry?.amountMinor).toBe(450_000);
    expect(entry?.flow).toBe("EXPENSE");
    expect(entry?.note).toBe("Kulaklık");
    expect(openItems()).toHaveLength(0);
    // Kept, not deleted: "did I already buy this" is a question a list has to
    // be able to answer.
    expect(wishlist()).toHaveLength(1);
    expect(wishlist()[0]?.transactionId).toBe(entry?.id);
  });

  it("counts as spending in the month it was bought", () => {
    const item = seed();
    const entry = useStore.getState().buyWishlistItem(item.id);
    const month = { from: `${entry!.date.slice(0, 7)}-01`, to: `${entry!.date.slice(0, 7)}-31` };

    expect(summarise(transactionsInRange(transactions(), month)).expense).toBe(450_000);
  });

  it("refuses to buy something with no price to charge", () => {
    const item = useStore.getState().addWishlistItem({ title: "Sandalye" });

    expect(useStore.getState().buyWishlistItem(item.id)).toBeNull();
    expect(transactions()).toHaveLength(0);
  });

  it("cannot buy the same thing twice", () => {
    const item = seed();
    useStore.getState().buyWishlistItem(item.id);

    expect(useStore.getState().buyWishlistItem(item.id)).toBeNull();
    expect(transactions()).toHaveLength(1);
  });

  /**
   * One act, one reversal. Undoing half of it would leave the budget charged
   * for something the list still says has not been bought.
   */
  it("undoes the entry and the item together", () => {
    const item = seed();
    useStore.getState().buyWishlistItem(item.id);

    expect(useUndoStore.getState().pending?.label).toBe("undoneWishlistBought");
    useUndoStore.getState().undo();

    expect(transactions()).toHaveLength(0);
    expect(openItems()).toHaveLength(1);
  });
});

describe("taking something off the list", () => {
  it("removes it, and offers it back", () => {
    const item = useStore.getState().addWishlistItem({ title: "Kulaklık", priceMinor: 450_000 });

    useStore.getState().removeWishlistItem(item.id);
    expect(openItems()).toHaveLength(0);

    expect(useUndoStore.getState().pending?.label).toBe("undoneWishlistRemoved");
    useUndoStore.getState().undo();
    expect(openItems()).toHaveLength(1);
  });

  it("keeps the order things were added in", () => {
    const store = useStore.getState();
    store.addWishlistItem({ title: "Kulaklık" });
    store.addWishlistItem({ title: "Monitör" });
    store.addWishlistItem({ title: "Sandalye" });

    expect(openItems().map((item) => item.title)).toEqual([
      "Kulaklık",
      "Monitör",
      "Sandalye",
    ]);
  });
});
