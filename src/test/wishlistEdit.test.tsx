import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/state/store";
import { Wishlist } from "@/ui/budget/Wishlist";

/**
 * A list of things you mean to buy is a list that gets corrected.
 *
 * A price typed from memory, a link pasted from the wrong tab, a thing renamed
 * once it is decided — and the only way to fix any of it was to delete the row
 * and type all three fields again, which loses the row's place in the list and
 * its history along with it. The store could already do this
 * (`updateWishlistItem`); nothing on screen reached it.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const store = () => useStore.getState();
const items = () => useStore.getState().db.wishlist.filter((i) => !i.deletedAt);
const only = () => items()[0]!;

const seed = () =>
  store().addWishlistItem({
    title: "Kulaklık",
    priceMinor: 450_000,
    url: "teknosa.com/x",
  });

const draw = () => render(<Wishlist currency="TRY" />);

/** Open the row for editing the way a person does: press its name. */
const openEditor = (name: string) =>
  act(() => {
    screen.getByRole("button", { name }).click();
  });

/**
 * Scoped to the row being edited.
 *
 * The add form at the top of the panel carries the same three fields, which is
 * the point — the edit row is the add row, in place — so an unscoped query
 * finds both.
 */
const editRow = () => {
  const row = document.querySelector<HTMLElement>(".wishlist-row.is-editing");
  if (!row) throw new Error("No row is open for editing");
  return row;
};

const field = (label: RegExp) => within(editRow()).getByLabelText(label);

describe("editing an item", () => {
  it("opens on the row itself, with what is already there", () => {
    seed();
    draw();
    openEditor("Kulaklık");

    expect((field(/Ne alınacak/) as HTMLInputElement).value).toBe("Kulaklık");
    expect((field(/^Fiyat$/) as HTMLInputElement).value).toBe("4500");
    expect((field(/Link/) as HTMLInputElement).value).toBe(
      "https://teknosa.com/x",
    );
  });

  it("saves the name, the price and the link together", () => {
    seed();
    draw();
    openEditor("Kulaklık");

    fireEvent.change(field(/Ne alınacak/), { target: { value: "Kulaklık Pro" } });
    fireEvent.change(field(/^Fiyat$/), { target: { value: "5200,50" } });
    fireEvent.change(field(/Link/), { target: { value: "hepsiburada.com/y" } });
    act(() => {
      within(editRow()).getByRole("button", { name: "Kaydet" }).click();
    });

    expect(only().title).toBe("Kulaklık Pro");
    expect(only().priceMinor).toBe(520_050);
    // The corrected link goes through the same check a new one does.
    expect(only().url).toBe("https://hepsiburada.com/y");
    // One item still, in its own place: this is an edit, not a re-add.
    expect(items()).toHaveLength(1);
  });

  it("keeps the row it edits, and its purchase history", () => {
    const before = seed();
    draw();
    openEditor("Kulaklık");
    fireEvent.change(field(/Ne alınacak/), { target: { value: "Kulaklık Pro" } });
    act(() => {
      within(editRow()).getByRole("button", { name: "Kaydet" }).click();
    });

    expect(only().id).toBe(before.id);
    expect(only().createdAt).toBe(before.createdAt);
  });

  it("clears the price when the field is emptied, rather than refusing", () => {
    // "I have not looked it up yet" is a real answer — it is the one the add
    // form already accepts.
    seed();
    draw();
    openEditor("Kulaklık");

    fireEvent.change(field(/^Fiyat$/), { target: { value: "" } });
    act(() => {
      within(editRow()).getByRole("button", { name: "Kaydet" }).click();
    });

    expect(only().priceMinor).toBeNull();
  });

  it("changes nothing when it is cancelled", () => {
    seed();
    draw();
    openEditor("Kulaklık");

    fireEvent.change(field(/Ne alınacak/), { target: { value: "Başka bir şey" } });
    act(() => {
      within(editRow()).getByRole("button", { name: "İptal" }).click();
    });

    expect(only().title).toBe("Kulaklık");
    expect(screen.getByRole("button", { name: "Kulaklık" })).toBeTruthy();
  });

  it("puts the row back on Escape", () => {
    seed();
    draw();
    openEditor("Kulaklık");

    fireEvent.keyDown(field(/Ne alınacak/), { key: "Escape" });

    expect(screen.getByRole("button", { name: "Kulaklık" })).toBeTruthy();
    expect(only().title).toBe("Kulaklık");
  });

  it("refuses to save a row with no name at all", () => {
    seed();
    draw();
    openEditor("Kulaklık");

    fireEvent.change(field(/Ne alınacak/), { target: { value: "   " } });
    const save = within(editRow()).getByRole("button", { name: "Kaydet" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(only().title).toBe("Kulaklık");
  });

  it("edits one row at a time", () => {
    seed();
    store().addWishlistItem({ title: "Monitör", priceMinor: 900_000, url: "" });
    draw();

    openEditor("Kulaklık");
    openEditor("Monitör");

    // The first row went back to being a row; only the second is a form.
    expect(screen.getByRole("button", { name: "Kulaklık" })).toBeTruthy();
    expect((field(/Ne alınacak/) as HTMLInputElement).value).toBe("Monitör");
  });
});
