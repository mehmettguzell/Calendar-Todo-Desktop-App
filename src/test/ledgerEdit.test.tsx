import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "@/data/db";
import { toLocalDate } from "@/domain/datetime";
import { useStore } from "@/state/store";
import { App } from "@/App";

/**
 * Correcting money that has already been written down.
 *
 * The shop charged 84,50 rather than 8,45; the card was the other one; it was
 * yesterday, not today. An amount typed once and then uncorrectable is an
 * amount nobody trusts, and a ledger nobody trusts stops being read.
 *
 * The editor itself has been there a while. What was missing was any sign of
 * it: the only thing that said a row could be corrected was a tooltip.
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
  act(() => {
    screen.getByRole("button", { name: /^(Budget|Bütçe)$/ }).click();
  });
}

const openTab = (name: RegExp) =>
  act(() => {
    within(
      screen.getByRole("tablist", { name: "Bütçe bölümleri" }),
    ).getByRole("tab", { name }).click();
  });

const entries = () =>
  useStore.getState().db.transactions.filter((t) => t.deletedAt === null);
const only = () => entries()[0]!;

const spend = (over: Record<string, unknown> = {}) =>
  act(() => {
    useStore.getState().addTransaction({
      date: today,
      amountMinor: 84_500,
      flow: "EXPENSE",
      categoryId: null,
      note: "Migros",
      ...over,
    });
  });

/** The editor that opens under the row. */
const editor = () => {
  const form = document.querySelector<HTMLElement>(".ledger-editor");
  if (!form) throw new Error("No row is open for editing");
  return form;
};

describe("an expense already written down", () => {
  it("says on the row itself that it can be corrected", async () => {
    await openBudget();
    spend();
    openTab(/İşlemler/);

    // Not a tooltip on the row: a control, in the place every other list in
    // the app puts one.
    expect(screen.getByRole("button", { name: "İşlemi düzenle" })).toBeTruthy();
  });

  it("opens the editor with what was entered", async () => {
    await openBudget();
    spend();
    openTab(/İşlemler/);

    act(() => {
      screen.getByRole("button", { name: "İşlemi düzenle" }).click();
    });

    expect(
      (within(editor()).getByLabelText("Tutar") as HTMLInputElement).value,
    ).toBe("845");
  });

  it("saves a corrected amount onto the same row", async () => {
    await openBudget();
    spend();
    const id = only().id;
    openTab(/İşlemler/);

    act(() => {
      screen.getByRole("button", { name: "İşlemi düzenle" }).click();
    });
    fireEvent.change(within(editor()).getByLabelText("Tutar"), {
      target: { value: "8,45" },
    });
    act(() => {
      within(editor()).getByRole("button", { name: /Kaydet/ }).click();
    });

    expect(only().id).toBe(id);
    expect(only().amountMinor).toBe(845);
    // One entry still: a correction is not a second purchase.
    expect(entries()).toHaveLength(1);
  });

  it("can be reached straight from the summary, where it was typed", async () => {
    await openBudget();

    // Type it on Özet, the way the quick-entry box is used.
    fireEvent.change(screen.getByPlaceholderText("Tutar"), {
      target: { value: "84,50" },
    });
    fireEvent.change(screen.getByPlaceholderText("Açıklama (isteğe bağlı)"), {
      target: { value: "Migros" },
    });
    act(() => {
      screen.getByRole("button", { name: /Ekle/ }).click();
    });

    // What was just added says so, and offers the way back to it — otherwise
    // the entry vanishes into a tab you have to know about.
    act(() => {
      screen.getByRole("button", { name: /^Düzenle$/ }).click();
    });

    expect(within(editor()).getByLabelText("Tutar")).toBeTruthy();
    expect(only().note).toBe("Migros");
  });
});
