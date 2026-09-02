import { act } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "@/data/db";
import { toLocalDate } from "@/domain/datetime";
import { useStore } from "@/state/store";
import { App } from "@/App";

/**
 * The budget page renders, with the wishlist above the month.
 *
 * The domain tests know what the numbers should be; this one exists because a
 * component that throws takes the whole tab with it, and neither a typecheck
 * nor a domain test notices that.
 */
const today = toLocalDate(new Date());

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ db: emptyDatabase(), ready: false, runningFocus: null });
});

async function openBudget() {
  render(<App />);
  await act(async () => {
    await useStore.getState().hydrate();
  });
  const nav = await screen.findByRole("button", { name: /^(Budget|Bütçe)$/ });
  act(() => {
    nav.click();
  });
}

describe("the budget tab", () => {
  it("shows the wishlist above the month's totals", async () => {
    await openBudget();

    expect(screen.getByText(/^(To buy|Alınacaklar)$/)).toBeDefined();
    // The list is empty, so it says how to start rather than showing nothing.
    expect(screen.getByPlaceholderText(/What do you want\?|Ne alınacak\?/)).toBeDefined();
  });

  it("lists an item with its price, and does not put it in the totals", async () => {
    await openBudget();

    act(() => {
      useStore.getState().addWishlistItem({
        title: "Kulaklık",
        priceMinor: 450_000,
        url: "teknosa.com/x",
      });
    });

    expect(screen.getByText("Kulaklık")).toBeDefined();
    // The link is rendered as a host, and only ever as http(s).
    const link = screen.getByRole("link", { name: /teknosa\.com/ });
    expect(link.getAttribute("href")).toBe("https://teknosa.com/x");
    // Nothing has been bought, so nothing has been spent.
    expect(useStore.getState().db.transactions).toHaveLength(0);
  });

  it("renders an instalment purchase as this month's charge", async () => {
    await openBudget();

    act(() => {
      useStore.getState().addTransaction({
        date: today,
        amountMinor: 1_200_000,
        flow: "EXPENSE",
        categoryId: null,
        note: "Telefon",
        instalments: 12,
      });
    });

    // The ledger row shows the charge, not the price, and says which one it is.
    expect(screen.getByText("1/12")).toBeDefined();
    expect(screen.getAllByText(/1\.000,00/).length).toBeGreaterThan(0);
  });
});
