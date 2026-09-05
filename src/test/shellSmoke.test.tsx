import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@/App";
import { useStore } from "@/state/store";
import { DICTIONARY } from "@/lib/i18n";

/**
 * Every screen still opens, and opens the same way.
 *
 * The redesign moved a lot at once: page headers, tab strips, the add box, the
 * row controls. Almost none of that is caught by a unit test — a header that
 * throws on an empty list, or a view that lost its nav entry, fails at the
 * moment a user clicks, and nowhere earlier. So this walks the sidebar the way
 * a person would and checks that each destination arrives.
 *
 * It also pins the two rules the redesign is *for*, because they are the ones
 * a later change would quietly undo: one add box per screen, and the view's
 * name printed once.
 */
const tr = DICTIONARY.tr as Record<string, string>;

async function mountApp() {
  render(<App />);
  await act(async () => {
    await useStore.getState().hydrate();
  });
}

const goTo = (label: string) =>
  act(() => {
    const nav = screen.getByRole("navigation");
    within(nav).getByRole("button", { name: new RegExp(label) }).click();
  });

beforeEach(async () => {
  await useStore.getState().resetDatabase();
});

describe("the shell", () => {
  it("opens every view in the sidebar without throwing", async () => {
    await mountApp();

    for (const key of [
      "navToday",
      "navTasks",
      "navPlans",
      "navCalendar",
      "navFocus",
      "navNotes",
      "navBudget",
    ]) {
      const label = tr[key];
      expect(label, key).toBeTruthy();
      goTo(label as string);
      // The topbar names the view it switched to. If the click had thrown,
      // React would have unmounted the tree and this would find nothing.
      expect(
        screen.getAllByText(label as string).length,
        key,
      ).toBeGreaterThan(0);
    }
  });

  it("puts exactly one add box on each screen that has one", async () => {
    await mountApp();

    for (const key of ["navToday", "navTasks", "navPlans"]) {
      goTo(tr[key] as string);
      const boxes = screen.getAllByLabelText(tr.formTitle as string);
      expect(boxes.length, key).toBe(1);
    }
  });

  it("names the view once, in the topbar, not twice", async () => {
    await mountApp();
    goTo(tr.navTasks as string);

    // One in the sidebar's nav item, one in the topbar heading — and nothing
    // repeating it a third time inside the page.
    expect(screen.getAllByText(tr.navTasks as string)).toHaveLength(2);
  });

  it("keeps the filter tabs and their counts on one strip", async () => {
    await mountApp();
    goTo(tr.navTasks as string);

    const tabs = screen.getByRole("tablist", {
      name: tr.tasksFilterAria as string,
    });
    expect(within(tabs).getAllByRole("tab").length).toBeGreaterThanOrEqual(3);
  });
});
