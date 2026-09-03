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

/** An instant on `day`, at an hour that is the same date in every zone. */
const noonOn = (day: string) => new Date(`${day}T12:00:00`).toISOString();

const batch = (over: Record<string, unknown> = {}) => ({
  id: "imp1",
  label: "Agustos.pdf",
  account: null,
  importedAt: noonOn(today),
  from: "2026-07-01",
  to: "2026-07-31",
  mode: "rows",
  createdCount: 12,
  createdMinor: 120_000,
  settled: [],
  revertedAt: null,
  deletedAt: null,
  ...over,
});

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

/**
 * The list is filed by the day an import happened, not the period it covers.
 *
 * A statement arrives weeks after its own month, so grouping by the period
 * would hide yesterday's mistaken import behind a month you are not looking at
 * — while grouping by the load date keeps the list to one month's worth and
 * still puts the row where somebody would go looking for it.
 */
describe("the imported statements list", () => {
  // After `hydrate`, not before: hydrating loads the (empty) document over
  // whatever the store was holding.
  const withBatches = async (batches: unknown[]) => {
    await openBudget();
    await act(async () => {
      useStore.setState((state) => ({
        db: { ...state.db, statementBatches: batches as never },
      }));
    });
  };

  it("lists a statement loaded this month, whatever period it covers", async () => {
    await withBatches([batch()]);

    expect(screen.getByText(/^(Imported statements|Yüklenen ekstreler)$/)).toBeDefined();
    expect(screen.getByText("2026-07-01 → 2026-07-31")).toBeDefined();
  });

  it("leaves out one loaded in another month, so the list cannot pile up", async () => {
    await withBatches([batch({ importedAt: noonOn("2024-02-15") })]);

    expect(screen.queryByText(/^(Imported statements|Yüklenen ekstreler)$/)).toBeNull();
  });

  it("says nothing at all until something has been imported", async () => {
    await withBatches([]);

    expect(screen.queryByText(/^(Imported statements|Yüklenen ekstreler)$/)).toBeNull();
  });

  it("offers the way back out", async () => {
    await withBatches([batch()]);

    expect(screen.getByRole("button", { name: /^(Undo|Geri al)$/ })).toBeDefined();
  });

  it("hides one that has already been taken back behind its own label", async () => {
    await withBatches([batch({ revertedAt: noonOn(today) })]);

    expect(screen.queryByRole("button", { name: /^(Undo|Geri al)$/ })).toBeNull();
    expect(screen.getByText(/^(Undone|Geri alındı)$/)).toBeDefined();
  });
});
